using System.Text.Json.Serialization;

namespace QaStudio.Application.Features.Dashboard.GetDashboard;

/// <summary>The dashboard. Field names are the contract the web app reads, kept from when the worker served it.</summary>
public sealed record DashboardData
{
    /// <summary>Counts of cases and of cases with an approved scenario.</summary>
    public required DashboardTotals Totals { get; init; }

    /// <summary>Each case's latest result, counted.</summary>
    public required LatestCounts Latest { get; init; }

    /// <summary>One row per module.</summary>
    public required IReadOnlyList<ModuleRow> Modules { get; init; }

    /// <summary>One cell per case, grouped by module, for the coverage map. Capped at <see cref="DashboardBuilder.MapLimit"/> cells.</summary>
    public required IReadOnlyList<MapModule> Map { get; init; }

    /// <summary>Whether the map had to leave cases out.</summary>
    public required bool MapTruncated { get; init; }

    /// <summary>The last finished runs, oldest first.</summary>
    public required IReadOnlyList<TrendPoint> Trend { get; init; }

    /// <summary>The newest runs, newest first.</summary>
    public required IReadOnlyList<RecentRun> RecentRuns { get; init; }

    /// <summary>Failed cases of high priority.</summary>
    public required IReadOnlyList<PriorityFailure> HighPriorityFailures { get; init; }

    /// <summary>How each number is calculated, in words.</summary>
    public required IReadOnlyList<string> Definitions { get; init; }
}

/// <summary>Case counts.</summary>
/// <param name="Cases">Every case in scope.</param>
/// <param name="WithScenario">Cases with an approved scenario.</param>
/// <param name="WithoutScenario">Cases without one.</param>
public sealed record DashboardTotals(int Cases, int WithScenario, int WithoutScenario);

/// <summary>Latest results, counted.</summary>
/// <param name="Passed">Cases whose latest result passed.</param>
/// <param name="Failed">Cases whose latest result failed.</param>
/// <param name="Blocked">Cases whose latest result was blocked.</param>
/// <param name="NotRun">Cases with no finished result yet. A cancelled run is not evidence, so it counts as not run.</param>
/// <param name="PassRate">passed / (passed + failed), or null when nothing has executed.</param>
public sealed record LatestCounts(int Passed, int Failed, int Blocked, int NotRun, double? PassRate);

/// <summary>One module's counts.</summary>
/// <param name="Module">The module, or "(no module)".</param>
/// <param name="Cases">Cases in it.</param>
/// <param name="WithScenario">Of those, with an approved scenario.</param>
/// <param name="Passed">Latest result passed.</param>
/// <param name="Failed">Latest result failed.</param>
/// <param name="Blocked">Latest result blocked.</param>
/// <param name="NotRun">No finished result yet.</param>
public sealed record ModuleRow(string Module, int Cases, int WithScenario, int Passed, int Failed, int Blocked, int NotRun);

/// <summary>One case on the coverage map.</summary>
/// <param name="Id">The case ID.</param>
/// <param name="Status">passed, failed, blocked or notRun.</param>
/// <param name="Scenario">Whether it has an approved scenario.</param>
public sealed record MapCell(string Id, string Status, bool Scenario);

/// <summary>A module's cells on the coverage map.</summary>
/// <param name="Module">The module.</param>
/// <param name="Cells">Its cases.</param>
public sealed record MapModule(string Module, IReadOnlyList<MapCell> Cells);

/// <summary>One finished run on the trend.</summary>
/// <param name="RunId">Run ID.</param>
/// <param name="At">When it started (or was created).</param>
/// <param name="Passed">Passed cases.</param>
/// <param name="Failed">Failed cases.</param>
/// <param name="Blocked">Blocked cases.</param>
/// <param name="Total">Cases in the run.</param>
/// <param name="PassRate">passed / (passed + failed), or null.</param>
public sealed record TrendPoint(string RunId, string At, int Passed, int Failed, int Blocked, int Total, double? PassRate);

/// <summary>One recent run.</summary>
/// <param name="Id">Run ID.</param>
/// <param name="Status">The run's status.</param>
/// <param name="At">When it started (or was created).</param>
/// <param name="Environment">Where it ran.</param>
/// <param name="Total">Cases in the run.</param>
/// <param name="PassRate">passed / (passed + failed), or null.</param>
public sealed record RecentRun(string Id, string Status, string At, string Environment, int Total, double? PassRate);

/// <summary>A failed high-priority case.</summary>
/// <param name="CaseId">The case ID.</param>
/// <param name="Title">The title.</param>
/// <param name="Module">The module, when it has one.</param>
/// <param name="Priority">The priority text.</param>
/// <param name="RunId">The run it failed in.</param>
/// <param name="Message">Why.</param>
public sealed record PriorityFailure(
    string CaseId,
    string Title,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Module,
    string Priority,
    string RunId,
    string Message);
