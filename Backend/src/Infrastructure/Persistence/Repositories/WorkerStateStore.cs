using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using QaStudio.Application.Abstractions;
using QaStudio.Core.Automation;

namespace QaStudio.Infrastructure.Persistence.Repositories;

/// <summary>EF Core store for the documents the execution worker owns.</summary>
/// <param name="db">The context.</param>
internal sealed class WorkerStateStore(QaStudioDbContext db) : IWorkerStateStore
{
    public Task UpsertScenarioAsync(ScenarioRecord record, CancellationToken cancellationToken) =>
        UpsertAsync(record, [record.CaseCode, record.Slot], (row, newer) => row.ReplaceWith(newer), cancellationToken);

    public Task DeleteScenarioAsync(string caseCode, ScenarioSlot slot, CancellationToken cancellationToken) =>
        DeleteIfPresentAsync<ScenarioRecord>([caseCode, slot], cancellationToken);

    public Task UpsertRevisionAsync(ScenarioRevision revision, CancellationToken cancellationToken) =>
        UpsertAsync(revision, [revision.CaseCode, revision.Version], (row, newer) => row.ReplaceWith(newer), cancellationToken);

    public async Task DeleteAllScenariosAsync(CancellationToken cancellationToken)
    {
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await db.ScenarioRecords.ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
        await db.ScenarioRevisions.ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
        db.ChangeTracker.Clear();
    }

    public Task UpsertRunAsync(TestRun run, CancellationToken cancellationToken) =>
        UpsertAsync(run, [run.Id], (row, newer) => row.ReplaceWith(newer), cancellationToken);

    public async Task DeleteAllRunsAsync(CancellationToken cancellationToken)
    {
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await db.TestRuns.ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
        db.ChangeTracker.Clear();
    }

    public Task UpsertConfigAsync(ConfigEntry entry, CancellationToken cancellationToken) =>
        UpsertAsync(entry, [entry.Key], (row, newer) => row.ReplaceWith(newer), cancellationToken);

    public Task UpsertAccountAsync(TestAccount account, CancellationToken cancellationToken) =>
        UpsertAsync(account, [account.Id], (row, newer) => row.ReplaceWith(newer), cancellationToken);

    public Task DeleteAccountAsync(string id, CancellationToken cancellationToken) =>
        DeleteIfPresentAsync<TestAccount>([id], cancellationToken);

    public Task UpsertSessionAsync(AccountSession session, CancellationToken cancellationToken) =>
        UpsertAsync(session, [session.AccountId], (row, newer) => row.ReplaceWith(newer), cancellationToken);

    public Task DeleteSessionAsync(string accountId, CancellationToken cancellationToken) =>
        DeleteIfPresentAsync<AccountSession>([accountId], cancellationToken);

    public Task UpsertAiKeyAsync(AiProviderKey key, CancellationToken cancellationToken) =>
        UpsertAsync(key, [key.Provider], (row, newer) => row.ReplaceWith(newer), cancellationToken);

    public Task DeleteAiKeyAsync(string provider, CancellationToken cancellationToken) =>
        DeleteIfPresentAsync<AiProviderKey>([provider], cancellationToken);

    public void AddAudit(AuditEntry entry) => db.AuditLog.Add(entry);

    public async Task UpsertBackupAsync(DataBackup backup, CancellationToken cancellationToken)
    {
        var row = await db.DataBackups.FindAsync([backup.Id], cancellationToken).ConfigureAwait(false);
        if (row is not null)
        {
            row.ReplaceWith(backup);
            return;
        }

        // Taken before the clear that follows, so this records where everything is right now.
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        var filing = await db.TestCases.AsNoTracking()
            .ToDictionaryAsync(c => c.CaseCode, c => c.TestSuiteId, StringComparer.Ordinal, cancellationToken)
            .ConfigureAwait(false);
        backup.RecordFiling(JsonSerializer.Serialize(filing));
        db.DataBackups.Add(backup);
    }

    public async Task<IReadOnlyDictionary<string, int>> ReadBackupFilingAsync(string id, CancellationToken cancellationToken)
    {
        var json = await db.DataBackups.AsNoTracking()
            .Where(b => b.Id == id)
            .Select(b => b.FilingJson)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);
        return json is null
            ? new Dictionary<string, int>(StringComparer.Ordinal)
            : JsonSerializer.Deserialize<Dictionary<string, int>>(json) ?? new Dictionary<string, int>(StringComparer.Ordinal);
    }

    public Task DeleteBackupAsync(string id, CancellationToken cancellationToken) =>
        DeleteIfPresentAsync<DataBackup>([id], cancellationToken);

    public async Task<WorkerStateData> ReadAllAsync(int runLimit, CancellationToken cancellationToken)
    {
        var newestRuns = await db.TestRuns.AsNoTracking().OrderByDescending(r => r.CreatedAtUtc).Take(runLimit).ToListAsync(cancellationToken).ConfigureAwait(false);
        newestRuns.Reverse();
        return new WorkerStateData
        {
            Scenarios = await db.ScenarioRecords.AsNoTracking().ToListAsync(cancellationToken).ConfigureAwait(false),
            Revisions = await db.ScenarioRevisions.AsNoTracking().OrderBy(r => r.CaseCode).ThenBy(r => r.Version).ToListAsync(cancellationToken).ConfigureAwait(false),
            Runs = newestRuns,
            Config = await db.ConfigEntries.AsNoTracking().ToListAsync(cancellationToken).ConfigureAwait(false),
            Accounts = await db.TestAccounts.AsNoTracking().ToListAsync(cancellationToken).ConfigureAwait(false),
            Sessions = await db.AccountSessions.AsNoTracking().ToListAsync(cancellationToken).ConfigureAwait(false),
            AiKeys = await db.AiProviderKeys.AsNoTracking().ToListAsync(cancellationToken).ConfigureAwait(false),
            Backups = await db.DataBackups.AsNoTracking().ToListAsync(cancellationToken).ConfigureAwait(false),
        };
    }

    private async Task UpsertAsync<T>(T incoming, object[] key, Action<T, T> replace, CancellationToken cancellationToken)
        where T : class
    {
        var row = await db.Set<T>().FindAsync(key, cancellationToken).ConfigureAwait(false);
        if (row is null)
        {
            db.Set<T>().Add(incoming);
            return;
        }

        replace(row, incoming);
    }

    private async Task DeleteIfPresentAsync<T>(object[] key, CancellationToken cancellationToken)
        where T : class
    {
        var row = await db.Set<T>().FindAsync(key, cancellationToken).ConfigureAwait(false);
        if (row is not null)
        {
            db.Set<T>().Remove(row);
            // Saved now so the same batch can write this key again without two tracked instances.
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
    }
}
