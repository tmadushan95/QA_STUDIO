using Dapper;
using Microsoft.Extensions.Options;
using QaStudio.Application.Abstractions;
using QaStudio.Infrastructure.Persistence.Dapper;

namespace QaStudio.Infrastructure.Persistence.Repositories;

/// <summary>
/// Dashboard aggregates in one round trip: several GROUP BY result sets read with Dapper's QueryMultiple. Every query
/// is covered by an existing index (suite, module, priority, version), so this stays cheap on large libraries.
/// </summary>
/// <param name="connections">Connection factory.</param>
/// <param name="options">Database settings, for the command timeout.</param>
internal sealed class InsightsReader(ISqlConnectionFactory connections, IOptions<DatabaseOptions> options) : IInsightsReader
{
    private const int TopSuites = 10;

    // Every statement reads the same scope: all cases, or one project's, or one version's. The scope is a parameterised
    // filter (never string-built), and each statement repeats it because a CTE lives for one statement only.
    private const string Scoped = """
        SELECT c.Id, c.TestSuiteId, c.ProjectVersionId, c.Priority, c.Readiness, c.CreatedAtUtc, s.ProjectId
        FROM dbo.TestCases c
        JOIN dbo.TestSuites s ON s.Id = c.TestSuiteId
        WHERE (@ProjectId IS NULL OR s.ProjectId = @ProjectId)
          AND (@VersionId IS NULL OR c.ProjectVersionId = @VersionId)
        """;

    private const string Sql = $"""
        WITH scoped AS ({Scoped})
        SELECT
            (SELECT COUNT_BIG(*) FROM scoped) AS TotalCases,
            (SELECT COUNT_BIG(*) FROM dbo.Projects WHERE @ProjectId IS NULL OR Id = @ProjectId) AS TotalProjects,
            (SELECT COUNT_BIG(*) FROM dbo.TestSuites WHERE @ProjectId IS NULL OR ProjectId = @ProjectId) AS TotalSuites,
            (SELECT COUNT_BIG(*) FROM dbo.ProjectVersions WHERE @ProjectId IS NULL OR ProjectId = @ProjectId) AS TotalVersions;

        WITH scoped AS ({Scoped})
        SELECT CAST(p.Id AS nvarchar(20)) AS [Key], p.Name AS Label, COUNT(c.Id) AS [Count]
        FROM dbo.Projects p
        LEFT JOIN scoped c ON c.ProjectId = p.Id
        WHERE @ProjectId IS NULL OR p.Id = @ProjectId
        GROUP BY p.Id, p.Name
        ORDER BY [Count] DESC, p.Name;

        WITH scoped AS ({Scoped})
        SELECT CAST(v.Id AS nvarchar(20)) AS [Key], CASE WHEN @ProjectId IS NULL THEN p.Name + N' · ' + v.Name ELSE v.Name END AS Label, COUNT(c.Id) AS [Count]
        FROM dbo.ProjectVersions v
        JOIN dbo.Projects p ON p.Id = v.ProjectId
        LEFT JOIN scoped c ON c.ProjectVersionId = v.Id
        WHERE (@ProjectId IS NULL OR v.ProjectId = @ProjectId) AND (@VersionId IS NULL OR v.Id = @VersionId)
        GROUP BY v.Id, p.Name, v.Name
        ORDER BY [Count] DESC, Label;

        WITH scoped AS ({Scoped})
        SELECT TOP (@TopSuites) CAST(s.Id AS nvarchar(20)) AS [Key], s.Name AS Label, COUNT(c.Id) AS [Count]
        FROM dbo.TestSuites s
        JOIN scoped c ON c.TestSuiteId = s.Id
        GROUP BY s.Id, s.Name
        ORDER BY [Count] DESC, s.Name;

        WITH scoped AS ({Scoped})
        SELECT ISNULL(Priority, N'(none)') AS [Key], ISNULL(Priority, N'(none)') AS Label, COUNT(*) AS [Count]
        FROM scoped
        GROUP BY Priority
        ORDER BY [Count] DESC;

        WITH scoped AS ({Scoped})
        SELECT Readiness AS [Key], Readiness AS Label, COUNT(*) AS [Count]
        FROM scoped
        GROUP BY Readiness
        ORDER BY [Count] DESC;

        WITH scoped AS ({Scoped})
        SELECT CAST(CreatedAtUtc AS date) AS Day, COUNT(*) AS [Count]
        FROM scoped
        WHERE CreatedAtUtc >= @Since
        GROUP BY CAST(CreatedAtUtc AS date)
        ORDER BY Day;
        """;

    public async Task<InsightsData> ReadAsync(DateTime sinceUtc, int? projectId, int? versionId, CancellationToken cancellationToken)
    {
        var connection = await connections.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using (connection.ConfigureAwait(false))
        {
            var command = new CommandDefinition(
                Sql,
                new { TopSuites, Since = sinceUtc, ProjectId = projectId, VersionId = versionId },
                commandTimeout: options.Value.CommandTimeoutSeconds,
                cancellationToken: cancellationToken);
            var grid = await connection.QueryMultipleAsync(command).ConfigureAwait(false);
            await using (grid.ConfigureAwait(false))
            {
                var totals = await grid.ReadSingleAsync<TotalsRow>().ConfigureAwait(false);
                var byProject = await ReadCountsAsync(grid).ConfigureAwait(false);
                var byVersion = await ReadCountsAsync(grid).ConfigureAwait(false);
                var bySuite = await ReadCountsAsync(grid).ConfigureAwait(false);
                var byPriority = await ReadCountsAsync(grid).ConfigureAwait(false);
                var byReadiness = await ReadCountsAsync(grid).ConfigureAwait(false);
                var perDay = await grid.ReadAsync<DayRow>().ConfigureAwait(false);
                return new InsightsData
                {
                    TotalCases = (int)totals.TotalCases,
                    TotalProjects = (int)totals.TotalProjects,
                    TotalSuites = (int)totals.TotalSuites,
                    TotalVersions = (int)totals.TotalVersions,
                    ByProject = byProject,
                    ByVersion = byVersion,
                    BySuite = bySuite,
                    ByPriority = byPriority,
                    ByReadiness = byReadiness,
                    AddedPerDay = [.. perDay.Select(d => new DayCount(DateOnly.FromDateTime(d.Day), d.Count))],
                };
            }
        }
    }

    private static async Task<IReadOnlyList<CountItem>> ReadCountsAsync(SqlMapper.GridReader grid) =>
        [.. (await grid.ReadAsync<CountRow>().ConfigureAwait(false)).Select(r => new CountItem(r.Key, r.Label, r.Count))];

    private sealed record TotalsRow(long TotalCases, long TotalProjects, long TotalSuites, long TotalVersions);

    private sealed record CountRow(string Key, string Label, int Count);

    private sealed record DayRow(DateTime Day, int Count);
}
