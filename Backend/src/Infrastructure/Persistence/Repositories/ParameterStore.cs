using Microsoft.EntityFrameworkCore;
using QaStudio.Application.Abstractions;
using QaStudio.Core.Automation;

namespace QaStudio.Infrastructure.Persistence.Repositories;

/// <summary>EF Core store for parameter values.</summary>
/// <param name="db">The context.</param>
internal sealed class ParameterStore(QaStudioDbContext db) : IParameterStore
{
    public async Task<IReadOnlyDictionary<string, string>> GetCaseAsync(string caseCode, CancellationToken cancellationToken) =>
        (await db.CaseParameterValues.AsNoTracking().Where(v => v.CaseCode == caseCode).ToListAsync(cancellationToken).ConfigureAwait(false))
            .ToDictionary(v => v.Name, v => v.Value, StringComparer.Ordinal);

    public async Task<IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>> GetCasesAsync(IReadOnlyCollection<string>? caseCodes, CancellationToken cancellationToken)
    {
        var query = db.CaseParameterValues.AsNoTracking();
        if (caseCodes is not null)
        {
            query = query.Where(v => caseCodes.Contains(v.CaseCode));
        }

        var rows = await query.ToListAsync(cancellationToken).ConfigureAwait(false);
        return rows.GroupBy(v => v.CaseCode, StringComparer.Ordinal).ToDictionary(
            g => g.Key,
            g => (IReadOnlyDictionary<string, string>)g.ToDictionary(v => v.Name, v => v.Value, StringComparer.Ordinal),
            StringComparer.Ordinal);
    }

    public async Task<IReadOnlyDictionary<int, IReadOnlyDictionary<string, string>>> GetProjectsAsync(IReadOnlyCollection<int>? projectIds, CancellationToken cancellationToken)
    {
        var query = db.ProjectParameterValues.AsNoTracking();
        if (projectIds is not null)
        {
            query = query.Where(v => projectIds.Contains(v.ProjectId));
        }

        var rows = await query.ToListAsync(cancellationToken).ConfigureAwait(false);
        return rows.GroupBy(v => v.ProjectId).ToDictionary(
            g => g.Key,
            g => (IReadOnlyDictionary<string, string>)g.ToDictionary(v => v.Name, v => v.Value, StringComparer.Ordinal));
    }

    public async Task ReplaceCaseAsync(string caseCode, IReadOnlyDictionary<string, string> values, DateTime atUtc, CancellationToken cancellationToken)
    {
        var existing = await db.CaseParameterValues.Where(v => v.CaseCode == caseCode).ToListAsync(cancellationToken).ConfigureAwait(false);
        db.CaseParameterValues.RemoveRange(existing.Where(v => !values.ContainsKey(v.Name)));
        foreach (var (name, value) in values)
        {
            var incoming = CaseParameterValue.Create(caseCode, name, value, atUtc);
            var row = existing.Find(v => string.Equals(v.Name, name, StringComparison.Ordinal));
            if (row is null)
            {
                db.CaseParameterValues.Add(incoming);
            }
            else if (!string.Equals(row.Value, value, StringComparison.Ordinal))
            {
                row.ReplaceWith(incoming);
            }
        }
    }

    public async Task ReplaceProjectAsync(int projectId, IReadOnlyDictionary<string, string> values, DateTime atUtc, CancellationToken cancellationToken)
    {
        var existing = await db.ProjectParameterValues.Where(v => v.ProjectId == projectId).ToListAsync(cancellationToken).ConfigureAwait(false);
        db.ProjectParameterValues.RemoveRange(existing.Where(v => !values.ContainsKey(v.Name)));
        foreach (var (name, value) in values)
        {
            var incoming = ProjectParameterValue.Create(projectId, name, value, atUtc);
            var row = existing.Find(v => string.Equals(v.Name, name, StringComparison.Ordinal));
            if (row is null)
            {
                db.ProjectParameterValues.Add(incoming);
            }
            else if (!string.Equals(row.Value, value, StringComparison.Ordinal))
            {
                row.ReplaceWith(incoming);
            }
        }
    }

    public async Task DeleteCasesAsync(IReadOnlyCollection<string> caseCodes, CancellationToken cancellationToken)
    {
        if (caseCodes.Count == 0)
        {
            return;
        }

        db.CaseParameterValues.RemoveRange(await db.CaseParameterValues.Where(v => caseCodes.Contains(v.CaseCode)).ToListAsync(cancellationToken).ConfigureAwait(false));
    }

    public async Task<int> DeleteAllCasesAsync(CancellationToken cancellationToken)
    {
        var cases = await db.CaseParameterValues.Select(v => v.CaseCode).Distinct().CountAsync(cancellationToken).ConfigureAwait(false);
        await db.CaseParameterValues.ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
        return cases;
    }
}
