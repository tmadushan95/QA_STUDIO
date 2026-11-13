using Dapper;
using Microsoft.Extensions.Options;
using QaStudio.Application.Abstractions;
using QaStudio.Infrastructure.Persistence.Dapper;

namespace QaStudio.Infrastructure.Persistence.Repositories;

/// <summary>
/// Reads the master data lists straight from SQL Server with Dapper. These are flat, read-only projections of small
/// tables, which is where Dapper beats EF: no change tracker, no model building, one round trip per list. Writes stay
/// on EF Core, which owns the schema, migrations and concurrency checks.
/// </summary>
/// <param name="connections">Connection factory.</param>
/// <param name="options">Database settings, for the command timeout.</param>
internal sealed class MasterDataReader(ISqlConnectionFactory connections, IOptions<DatabaseOptions> options) : IMasterDataReader
{
    private const string ProjectsSql = """
        SELECT Id, Code, Name, Description, IsActive, RowVersion
        FROM dbo.Projects
        ORDER BY Name;
        """;

    private const string SuitesSql = """
        SELECT Id, ProjectId, Name, Description, SortOrder, IsActive, RowVersion
        FROM dbo.TestSuites
        ORDER BY SortOrder, Name;
        """;

    // Newest release first: a dated version before an undated one, then the most recently created.
    private const string VersionsSql = """
        SELECT Id, ProjectId, Name, Description, ReleaseDate, IsCurrent, IsActive, RowVersion
        FROM dbo.ProjectVersions
        ORDER BY ProjectId, CASE WHEN ReleaseDate IS NULL THEN 1 ELSE 0 END, ReleaseDate DESC, Id DESC;
        """;

    public async Task<IReadOnlyList<ProjectItem>> ListProjectsAsync(CancellationToken cancellationToken)
    {
        var rows = await QueryAsync<ProjectRow>(ProjectsSql, cancellationToken).ConfigureAwait(false);
        return [.. rows.Select(p => new ProjectItem(p.Id, p.Code, p.Name, p.Description, p.IsActive, Convert.ToBase64String(p.RowVersion)))];
    }

    public async Task<IReadOnlyList<TestSuiteItem>> ListSuitesAsync(CancellationToken cancellationToken)
    {
        var rows = await QueryAsync<SuiteRow>(SuitesSql, cancellationToken).ConfigureAwait(false);
        return [.. rows.Select(s => new TestSuiteItem(s.Id, s.ProjectId, s.Name, s.Description, s.SortOrder, s.IsActive, Convert.ToBase64String(s.RowVersion)))];
    }

    public async Task<IReadOnlyList<ProjectVersionItem>> ListVersionsAsync(CancellationToken cancellationToken)
    {
        var rows = await QueryAsync<VersionRow>(VersionsSql, cancellationToken).ConfigureAwait(false);
        return
        [
            .. rows.Select(v => new ProjectVersionItem(
                v.Id,
                v.ProjectId,
                v.Name,
                v.Description,
                v.ReleaseDate is { } date ? DateOnly.FromDateTime(date) : null,
                v.IsCurrent,
                v.IsActive,
                Convert.ToBase64String(v.RowVersion))),
        ];
    }

    private async Task<IEnumerable<T>> QueryAsync<T>(string sql, CancellationToken cancellationToken)
    {
        var connection = await connections.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using (connection.ConfigureAwait(false))
        {
            var command = new CommandDefinition(sql, commandTimeout: options.Value.CommandTimeoutSeconds, cancellationToken: cancellationToken);
            return await connection.QueryAsync<T>(command).ConfigureAwait(false);
        }
    }

    // Row shapes Dapper fills by column name; kept private so the public read models stay free of byte[] tokens.
    private sealed record ProjectRow(int Id, string Code, string Name, string? Description, bool IsActive, byte[] RowVersion);

    private sealed record SuiteRow(int Id, int ProjectId, string Name, string? Description, int SortOrder, bool IsActive, byte[] RowVersion);

    private sealed record VersionRow(int Id, int ProjectId, string Name, string? Description, DateTime? ReleaseDate, bool IsCurrent, bool IsActive, byte[] RowVersion);
}
