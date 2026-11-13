namespace QaStudio.Application.Abstractions;

/// <summary>One test case, as the dashboard needs it.</summary>
/// <param name="Code">The case ID.</param>
/// <param name="Title">The title.</param>
/// <param name="Module">The module, when it has one.</param>
/// <param name="Priority">The priority text, when it has one.</param>
public sealed record DashboardCase(string Code, string Title, string? Module, string? Priority);

/// <summary>One case's result inside a run.</summary>
/// <param name="CaseCode">The case ID.</param>
/// <param name="Status">passed, failed, blocked, skipped, cancelled, queued or running.</param>
/// <param name="Account">The test account it ran as, when there was one.</param>
/// <param name="FailureMessage">Why it failed or was blocked, when it was.</param>
public sealed record DashboardResult(string CaseCode, string Status, string? Account, string? FailureMessage);

/// <summary>One run, as the dashboard needs it.</summary>
/// <param name="Id">Run ID.</param>
/// <param name="Status">The run's own status.</param>
/// <param name="CreatedAt">When it was created (ISO text, as stored).</param>
/// <param name="StartedAt">When it started, when it has.</param>
/// <param name="Environment">The environment (or environments) it ran in.</param>
/// <param name="Results">Per-case results.</param>
public sealed record DashboardRun(
    string Id,
    string Status,
    string CreatedAt,
    string? StartedAt,
    string Environment,
    IReadOnlyList<DashboardResult> Results);

/// <summary>What the dashboard is computed from.</summary>
/// <param name="Cases">The cases in scope.</param>
/// <param name="Runs">Stored runs, in any order.</param>
/// <param name="ApprovedCaseCodes">Cases that have an approved scenario.</param>
/// <param name="Scoped">Whether the cases were narrowed to a project or version, so runs are narrowed too.</param>
public sealed record DashboardInput(
    IReadOnlyList<DashboardCase> Cases,
    IReadOnlyList<DashboardRun> Runs,
    IReadOnlySet<string> ApprovedCaseCodes,
    bool Scoped);

/// <summary>Reads what the dashboard is computed from.</summary>
public interface IDashboardReader
{
    /// <summary>Reads the cases, runs and approved scenarios, optionally for one project and version.</summary>
    /// <param name="projectId">Only this project's cases, when given.</param>
    /// <param name="versionId">Only this version's cases, when given.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The input.</returns>
    Task<DashboardInput> ReadAsync(int? projectId, int? versionId, CancellationToken cancellationToken);
}
