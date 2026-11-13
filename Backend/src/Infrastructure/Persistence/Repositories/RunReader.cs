using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;
using QaStudio.Infrastructure.Persistence.Dapper;

namespace QaStudio.Infrastructure.Persistence.Repositories;

/// <summary>
/// Reads stored runs with Dapper. The list is every run still going plus the most recent finished ones (the same history
/// the worker keeps in memory); the run document is returned as it was stored. A document that cannot be read is skipped
/// rather than failing the whole list.
/// </summary>
/// <param name="connections">Connection factory.</param>
/// <param name="options">Database settings, for the command timeout.</param>
/// <param name="limits">How many finished runs the history keeps.</param>
/// <param name="logger">Logger.</param>
internal sealed partial class RunReader(
    ISqlConnectionFactory connections,
    IOptions<DatabaseOptions> options,
    IOptions<LimitsOptions> limits,
    ILogger<RunReader> logger) : IRunReader
{
    private const string ListSql = """
        SELECT r.Json
        FROM (
            SELECT Json, CreatedAtUtc FROM dbo.TestRuns WHERE Status IN ('queued', 'running')
            UNION ALL
            SELECT f.Json, f.CreatedAtUtc
            FROM (
                SELECT TOP (@Finished) Json, CreatedAtUtc
                FROM dbo.TestRuns
                WHERE Status NOT IN ('queued', 'running')
                ORDER BY CreatedAtUtc DESC
            ) f
        ) r
        ORDER BY r.CreatedAtUtc DESC;
        """;

    // The scope is a parameterised filter, never string-built; the same rule the dashboard and insights use.
    private const string ScopeSql = """
        SELECT c.CaseCode
        FROM dbo.TestCases c
        JOIN dbo.TestSuites s ON s.Id = c.TestSuiteId
        WHERE (@ProjectId IS NULL OR s.ProjectId = @ProjectId)
          AND (@VersionId IS NULL OR c.ProjectVersionId = @VersionId);
        """;

    private const string GetSql = "SELECT Json FROM dbo.TestRuns WHERE Id = @Id;";

    public async Task<RunHistory> ListAsync(int? projectId, int? versionId, CancellationToken cancellationToken)
    {
        var connection = await connections.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using (connection.ConfigureAwait(false))
        {
            var documents = await connection.QueryAsync<string>(Command(ListSql, new { Finished = limits.Value.SnapshotRuns }, cancellationToken)).ConfigureAwait(false);
            IReadOnlySet<string>? scope = null;
            if (projectId is not null || versionId is not null)
            {
                var codes = await connection.QueryAsync<string>(Command(ScopeSql, new { ProjectId = projectId, VersionId = versionId }, cancellationToken)).ConfigureAwait(false);
                scope = codes.ToHashSet(StringComparer.Ordinal);
            }

            return new RunHistory([.. documents.Select(Read).OfType<JsonObject>()], scope);
        }
    }

    public async Task<JsonObject?> GetAsync(string id, CancellationToken cancellationToken)
    {
        var connection = await connections.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using (connection.ConfigureAwait(false))
        {
            var json = await connection.QuerySingleOrDefaultAsync<string>(Command(GetSql, new { Id = id }, cancellationToken)).ConfigureAwait(false);
            return json is null ? null : Read(json);
        }
    }

    private CommandDefinition Command(string sql, object parameters, CancellationToken cancellationToken) =>
        new(sql, parameters, commandTimeout: options.Value.CommandTimeoutSeconds, cancellationToken: cancellationToken);

    private JsonObject? Read(string json)
    {
        try
        {
            return JsonNode.Parse(json) as JsonObject;
        }
        catch (JsonException ex)
        {
            LogUnreadableRun(ex);
            return null;
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "A stored run could not be read and was skipped.")]
    private partial void LogUnreadableRun(Exception exception);
}
