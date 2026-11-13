using Dapper;
using Microsoft.Extensions.Options;
using QaStudio.Application.Abstractions;
using QaStudio.Core.Automation;
using QaStudio.Infrastructure.Persistence.Dapper;

namespace QaStudio.Infrastructure.Persistence.Repositories;

/// <summary>
/// Reads each case with the scenario its parameters come from, with Dapper. The draft wins over the approved scenario, as
/// it does when the worker lists what a case needs, so a name added in a draft is shown at once.
/// </summary>
/// <param name="connections">Connection factory.</param>
/// <param name="options">Database settings, for the command timeout.</param>
internal sealed class ParameterCaseReader(ISqlConnectionFactory connections, IOptions<DatabaseOptions> options) : IParameterCaseReader
{
    private const string Sql = """
        SELECT c.CaseCode AS Code, s.ProjectId, COALESCE(d.Json, a.Json) AS ScenarioJson
        FROM dbo.TestCases c
        JOIN dbo.TestSuites s ON s.Id = c.TestSuiteId
        LEFT JOIN dbo.ScenarioRecords d ON d.CaseCode = c.CaseCode AND d.Slot = @Draft
        LEFT JOIN dbo.ScenarioRecords a ON a.CaseCode = c.CaseCode AND a.Slot = @Approved
        WHERE (@CaseCode IS NULL OR c.CaseCode = @CaseCode)
          AND (@ProjectId IS NULL OR s.ProjectId = @ProjectId)
        ORDER BY c.Id;
        """;

    private const string ContextSql = """
        SELECT c.Title, st.[Action]
        FROM dbo.TestCases c
        LEFT JOIN dbo.TestCaseSteps st ON st.TestCaseId = c.Id
        WHERE c.CaseCode = @CaseCode
        ORDER BY st.StepOrder;
        """;

    public async Task<ParameterCaseContext?> ReadContextAsync(string caseCode, CancellationToken cancellationToken)
    {
        var connection = await connections.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using (connection.ConfigureAwait(false))
        {
            var command = new CommandDefinition(ContextSql, new { CaseCode = caseCode }, commandTimeout: options.Value.CommandTimeoutSeconds, cancellationToken: cancellationToken);
            var rows = (await connection.QueryAsync<ContextRow>(command).ConfigureAwait(false)).ToList();
            return rows.Count == 0 ? null : new ParameterCaseContext(rows[0].Title, [.. rows.Select(r => r.Action).OfType<string>()]);
        }
    }

    private sealed record ContextRow(string Title, string? Action);

    private const string ProjectsSql = """
        SELECT c.CaseCode AS Code, s.ProjectId
        FROM dbo.TestCases c
        JOIN dbo.TestSuites s ON s.Id = c.TestSuiteId
        WHERE c.CaseCode IN @Codes;
        """;

    public async Task<IReadOnlyDictionary<string, int>> ReadProjectsAsync(IReadOnlyCollection<string> caseCodes, CancellationToken cancellationToken)
    {
        if (caseCodes.Count == 0)
        {
            return new Dictionary<string, int>();
        }

        var connection = await connections.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using (connection.ConfigureAwait(false))
        {
            var command = new CommandDefinition(ProjectsSql, new { Codes = caseCodes }, commandTimeout: options.Value.CommandTimeoutSeconds, cancellationToken: cancellationToken);
            return (await connection.QueryAsync<ProjectRow>(command).ConfigureAwait(false)).ToDictionary(r => r.Code, r => r.ProjectId, StringComparer.Ordinal);
        }
    }

    private sealed record ProjectRow(string Code, int ProjectId);

    public async Task<IReadOnlyList<ParameterCase>> ReadAsync(string? caseCode, int? projectId, CancellationToken cancellationToken)
    {
        var connection = await connections.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using (connection.ConfigureAwait(false))
        {
            var command = new CommandDefinition(
                Sql,
                new { CaseCode = caseCode, ProjectId = projectId, Draft = (byte)ScenarioSlot.Draft, Approved = (byte)ScenarioSlot.Approved },
                commandTimeout: options.Value.CommandTimeoutSeconds,
                cancellationToken: cancellationToken);
            return [.. await connection.QueryAsync<ParameterCase>(command).ConfigureAwait(false)];
        }
    }
}
