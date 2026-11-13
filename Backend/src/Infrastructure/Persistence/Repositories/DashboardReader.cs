using System.Text.Json;
using System.Text.Json.Serialization;
using Dapper;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;
using QaStudio.Core.Automation;
using QaStudio.Infrastructure.Persistence.Dapper;

namespace QaStudio.Infrastructure.Persistence.Repositories;

/// <summary>
/// Reads what the dashboard is computed from with Dapper: the cases in scope, the stored runs and the cases that have an
/// approved scenario, in one round trip. The run document is the worker's; only the few fields the dashboard needs are
/// read from it, and a run that cannot be read is skipped rather than failing the whole dashboard.
/// </summary>
/// <param name="connections">Connection factory.</param>
/// <param name="options">Database settings, for the command timeout.</param>
/// <param name="limits">How many runs the history keeps.</param>
/// <param name="logger">Logger.</param>
internal sealed partial class DashboardReader(
    ISqlConnectionFactory connections,
    IOptions<DatabaseOptions> options,
    IOptions<LimitsOptions> limits,
    ILogger<DashboardReader> logger) : IDashboardReader
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // The scope is a parameterised filter, never string-built. Ordered by ID, like the library list.
    private const string Sql = """
        SELECT c.CaseCode AS Code, c.Title, c.Module, c.Priority
        FROM dbo.TestCases c
        JOIN dbo.TestSuites s ON s.Id = c.TestSuiteId
        WHERE (@ProjectId IS NULL OR s.ProjectId = @ProjectId)
          AND (@VersionId IS NULL OR c.ProjectVersionId = @VersionId)
        ORDER BY c.Id;

        SELECT TOP (@Runs) r.Json
        FROM dbo.TestRuns r
        ORDER BY r.CreatedAtUtc DESC;

        SELECT s.CaseCode
        FROM dbo.ScenarioRecords s
        WHERE s.Slot = @Approved;
        """;

    public async Task<DashboardInput> ReadAsync(int? projectId, int? versionId, CancellationToken cancellationToken)
    {
        var connection = await connections.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using (connection.ConfigureAwait(false))
        {
            var command = new CommandDefinition(
                Sql,
                new { ProjectId = projectId, VersionId = versionId, Runs = limits.Value.SnapshotRuns, Approved = (byte)ScenarioSlot.Approved },
                commandTimeout: options.Value.CommandTimeoutSeconds,
                cancellationToken: cancellationToken);
            var grid = await connection.QueryMultipleAsync(command).ConfigureAwait(false);
            await using (grid.ConfigureAwait(false))
            {
                var cases = (await grid.ReadAsync<CaseRow>().ConfigureAwait(false))
                    .Select(c => new DashboardCase(c.Code, c.Title, c.Module, c.Priority))
                    .ToList();
                var documents = await grid.ReadAsync<string>().ConfigureAwait(false);
                var approved = (await grid.ReadAsync<string>().ConfigureAwait(false)).ToHashSet(StringComparer.Ordinal);
                return new DashboardInput(cases, [.. documents.Select(Read).OfType<DashboardRun>()], approved, projectId is not null || versionId is not null);
            }
        }
    }

    private DashboardRun? Read(string json)
    {
        try
        {
            var doc = JsonSerializer.Deserialize<RunDoc>(json, Json);
            if (doc?.Id is null || doc.Status is null || doc.CreatedAt is null)
            {
                return null;
            }

            var results = (doc.Cases ?? [])
                .Where(c => c.CaseId is not null && c.Status is not null)
                .Select(c => new DashboardResult(c.CaseId!, c.Status!, c.Account, c.Failure is null ? null : c.Failure.Message ?? string.Empty))
                .ToList();
            return new DashboardRun(doc.Id, doc.Status, doc.CreatedAt, doc.StartedAt, doc.Environment ?? string.Empty, results);
        }
        catch (JsonException ex)
        {
            LogUnreadableRun(ex);
            return null;
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "A stored run could not be read for the dashboard and was skipped.")]
    private partial void LogUnreadableRun(Exception exception);

    private sealed record CaseRow(string Code, string Title, string? Module, string? Priority);

    private sealed record RunDoc(
        string? Id,
        string? Status,
        string? CreatedAt,
        string? StartedAt,
        string? Environment,
        [property: JsonPropertyName("cases")] List<ResultDoc>? Cases);

    private sealed record ResultDoc(string? CaseId, string? Status, string? Account, FailureDoc? Failure);

    private sealed record FailureDoc(string? Message);
}
