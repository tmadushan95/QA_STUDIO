using QaStudio.Core.Automation;

namespace QaStudio.Application.Abstractions;

/// <summary>Document state owned by the execution worker: scenarios, runs, settings, accounts and so on.</summary>
public interface IWorkerStateStore
{
    /// <summary>Inserts or replaces a scenario record.</summary>
    /// <param name="record">The record.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when queued.</returns>
    Task UpsertScenarioAsync(ScenarioRecord record, CancellationToken cancellationToken);

    /// <summary>Queues removal of a scenario record, if there is one.</summary>
    /// <param name="caseCode">The case ID.</param>
    /// <param name="slot">Draft or approved.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when queued.</returns>
    Task DeleteScenarioAsync(string caseCode, ScenarioSlot slot, CancellationToken cancellationToken);

    /// <summary>Inserts or replaces a scenario revision.</summary>
    /// <param name="revision">The revision.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when queued.</returns>
    Task UpsertRevisionAsync(ScenarioRevision revision, CancellationToken cancellationToken);

    /// <summary>Removes all scenarios and revisions at once. Pending changes are saved first.</summary>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when done.</returns>
    Task DeleteAllScenariosAsync(CancellationToken cancellationToken);

    /// <summary>Inserts or replaces a run.</summary>
    /// <param name="run">The run.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when queued.</returns>
    Task UpsertRunAsync(TestRun run, CancellationToken cancellationToken);

    /// <summary>Removes every run at once. Pending changes are saved first.</summary>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when done.</returns>
    Task DeleteAllRunsAsync(CancellationToken cancellationToken);

    /// <summary>Inserts or replaces a configuration block.</summary>
    /// <param name="entry">The entry.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when queued.</returns>
    Task UpsertConfigAsync(ConfigEntry entry, CancellationToken cancellationToken);

    /// <summary>Inserts or replaces a test account.</summary>
    /// <param name="account">The account.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when queued.</returns>
    Task UpsertAccountAsync(TestAccount account, CancellationToken cancellationToken);

    /// <summary>Queues removal of a test account and its session.</summary>
    /// <param name="id">The account ID.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when queued.</returns>
    Task DeleteAccountAsync(string id, CancellationToken cancellationToken);

    /// <summary>Inserts or replaces a saved browser session.</summary>
    /// <param name="session">The session.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when queued.</returns>
    Task UpsertSessionAsync(AccountSession session, CancellationToken cancellationToken);

    /// <summary>Queues removal of a saved browser session.</summary>
    /// <param name="accountId">The account ID.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when queued.</returns>
    Task DeleteSessionAsync(string accountId, CancellationToken cancellationToken);

    /// <summary>Inserts or replaces an AI provider key.</summary>
    /// <param name="key">The key.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when queued.</returns>
    Task UpsertAiKeyAsync(AiProviderKey key, CancellationToken cancellationToken);

    /// <summary>Queues removal of an AI provider key.</summary>
    /// <param name="provider">The provider.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when queued.</returns>
    Task DeleteAiKeyAsync(string provider, CancellationToken cancellationToken);

    /// <summary>Queues an audit entry with its original time.</summary>
    /// <param name="entry">The entry.</param>
    void AddAudit(AuditEntry entry);

    /// <summary>Inserts or replaces a backup.</summary>
    /// <param name="backup">The backup.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when queued.</returns>
    Task UpsertBackupAsync(DataBackup backup, CancellationToken cancellationToken);

    /// <summary>Reads where a backup's cases were filed.</summary>
    /// <param name="id">The backup ID.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>Suite key by case ID; empty if the backup is unknown or older than this feature.</returns>
    Task<IReadOnlyDictionary<string, int>> ReadBackupFilingAsync(string id, CancellationToken cancellationToken);

    /// <summary>Queues removal of a backup.</summary>
    /// <param name="id">The backup ID.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when queued.</returns>
    Task DeleteBackupAsync(string id, CancellationToken cancellationToken);

    /// <summary>Reads everything the worker loads at start-up, without tracking.</summary>
    /// <param name="runLimit">How many of the newest runs to include.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The state.</returns>
    Task<WorkerStateData> ReadAllAsync(int runLimit, CancellationToken cancellationToken);
}
