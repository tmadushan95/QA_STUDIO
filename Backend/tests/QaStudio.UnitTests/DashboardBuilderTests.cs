using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Dashboard.GetDashboard;

namespace QaStudio.UnitTests;

/// <summary>
/// The dashboard rules. These are the cases the worker's own tests held when it served the dashboard, kept as they were so
/// the move to .NET is shown to change no number.
/// </summary>
public class DashboardBuilderTests
{
    private static readonly DashboardCase[] Cases =
    [
        new("A", "T A", "Projects", "High"),
        new("B", "T B", "Projects", "Low"),
        new("C", "T C", "Approvals", "critical"),
        new("D", "T D", null, null),
        new("E", "T E", "Approvals", null),
    ];

    private static DashboardResult Res(string id, string status, string message = "", string? account = null) =>
        new(id, status, account, message.Length == 0 ? null : message);

    private static DashboardRun Run(string id, int day, string status, params DashboardResult[] results) =>
        new(id, status, $"2026-01-{day:D2}T00:00:00Z", null, "qa", results);

    private static DashboardData Build(IEnumerable<DashboardRun> runs, IEnumerable<string>? approved = null, IEnumerable<DashboardCase>? cases = null, bool scoped = false) =>
        DashboardBuilder.Build(new DashboardInput([.. cases ?? Cases], [.. runs], new HashSet<string>(approved ?? []), scoped));

    [Fact]
    public void With_no_runs_everything_is_not_run_and_nothing_is_invented()
    {
        var d = Build([], ["A"]);
        Assert.Equal(new DashboardTotals(5, 1, 4), d.Totals);
        Assert.Equal(new LatestCounts(0, 0, 0, 5, null), d.Latest);
        Assert.Empty(d.Trend);
        Assert.Empty(d.RecentRuns);
        Assert.Empty(d.HighPriorityFailures);
    }

    [Fact]
    public void Each_case_uses_its_most_recent_finished_result_whatever_order_runs_arrive_in()
    {
        var old = Run("r1", 1, "failed", Res("A", "failed", "old failure"), Res("B", "passed"));
        var recent = Run("r2", 2, "failed", Res("A", "passed"), Res("C", "failed", "broken"), Res("D", "blocked"));
        var d = Build([recent, old], ["A", "B", "C"]);
        Assert.Equal(2, d.Latest.Passed);
        Assert.Equal(1, d.Latest.Failed);
        Assert.Equal(1, d.Latest.Blocked);
        Assert.Equal(1, d.Latest.NotRun);
        Assert.Equal(2d / 3, d.Latest.PassRate!.Value, 6);
        Assert.Equal(
            [
                new ModuleRow("(no module)", 1, 0, 0, 0, 1, 0),
                new ModuleRow("Approvals", 2, 1, 0, 1, 0, 1),
                new ModuleRow("Projects", 2, 2, 2, 0, 0, 0),
            ],
            d.Modules);
    }

    [Fact]
    public void High_priority_failures_are_listed_only_for_currently_failing_cases()
    {
        var r1 = Run("r1", 1, "failed", Res("A", "failed", "was failing"), Res("C", "failed", "still failing"), Res("B", "failed", "low prio"));
        var r2 = Run("r2", 2, "passed", Res("A", "passed"));
        var d = Build([r1, r2]);
        var failure = Assert.Single(d.HighPriorityFailures);
        Assert.Equal(new PriorityFailure("C", "T C", "Approvals", "critical", "r1", "still failing"), failure);
    }

    [Fact]
    public void A_cancelled_run_does_not_erase_earlier_results_and_in_progress_runs_stay_out_of_the_trend()
    {
        var r1 = Run("r1", 1, "passed", Res("A", "passed"));
        var r2 = Run("r2", 2, "cancelled", Res("A", "cancelled"));
        var r3 = Run("r3", 3, "running", Res("B", "running"));
        var d = Build([r1, r2, r3]);
        Assert.Equal(new LatestCounts(1, 0, 0, 4, 1d), d.Latest);
        Assert.Equal(["r1"], d.Trend.Select(t => t.RunId));
        Assert.Equal(["r3", "r2", "r1"], d.RecentRuns.Select(r => r.Id));
    }

    [Fact]
    public void The_trend_and_recent_lists_are_bounded_and_results_of_removed_cases_are_ignored()
    {
        var many = Enumerable.Range(1, 30).Select(i => Run($"r{i}", i, "passed", Res("A", "passed"), Res("GONE", "failed")));
        var d = Build(many);
        Assert.Equal(20, d.Trend.Count);
        Assert.Equal("r11", d.Trend[0].RunId);
        Assert.Equal("r30", d.Trend[^1].RunId);
        Assert.Equal(0, d.Latest.Failed);
        Assert.Equal(8, d.RecentRuns.Count);
        Assert.True(d.Definitions.Count > 3);
    }

    [Fact]
    public void The_coverage_map_has_one_cell_per_case_grouped_by_module_and_is_capped()
    {
        var r = Run("r1", 1, "failed", Res("A", "passed"), Res("C", "failed", "x"), Res("D", "blocked"));
        var d = Build([r], ["A", "C"]);
        Assert.False(d.MapTruncated);
        Assert.Equal(["(no module)", "Approvals", "Projects"], d.Map.Select(m => m.Module));
        Assert.Equal([new MapCell("A", "passed", true), new MapCell("B", "notRun", false)], d.Map.Single(m => m.Module == "Projects").Cells);
        Assert.Equal([new MapCell("C", "failed", true), new MapCell("E", "notRun", false)], d.Map.Single(m => m.Module == "Approvals").Cells);

        var many = Enumerable.Range(0, 1600).Select(i => new DashboardCase($"X{i}", "t", "M", null));
        var big = Build([], cases: many);
        Assert.True(big.MapTruncated);
        Assert.Equal(1500, big.Map[0].Cells.Count);
        Assert.Equal(1600, big.Totals.Cases); // totals are never truncated
    }

    [Fact]
    public void A_case_is_judged_by_its_worst_account_so_one_account_passing_never_hides_another_failing()
    {
        var r1 = Run(
            "r1",
            1,
            "failed",
            Res("A", "passed", account: "Alice"),
            Res("A", "failed", "Gate not shown", "Bob"),
            Res("B", "passed", account: "Alice"),
            Res("B", "blocked", "sign-in failed", "Bob"),
            Res("C", "passed", account: "Alice"),
            Res("C", "passed", account: "Bob"));
        var d = Build([r1]);
        Assert.Equal(new LatestCounts(1, 1, 1, 2, 0.5), d.Latest); // A failed, B blocked, C passed
        Assert.Equal("Gate not shown (as Bob)", d.HighPriorityFailures[0].Message);

        // A later run as Bob only updates Bob's result; Alice's earlier result still counts.
        var r2 = Run("r2", 2, "passed", Res("A", "passed", account: "Bob"));
        Assert.Equal(0, Build([r1, r2]).Latest.Failed);
    }

    [Fact]
    public void A_narrowed_dashboard_keeps_only_the_results_of_its_cases_and_drops_runs_with_none_left()
    {
        var inProject = Cases.Where(c => c.Module == "Projects").ToList();
        var r1 = Run("r1", 1, "failed", Res("A", "failed", "x"), Res("C", "failed", "elsewhere"));
        var r2 = Run("r2", 2, "passed", Res("C", "passed"));
        var d = Build([r1, r2], cases: inProject, scoped: true);
        Assert.Equal(1, d.Latest.Failed);
        Assert.Equal(["r1"], d.RecentRuns.Select(r => r.Id));
        Assert.Equal(1, d.RecentRuns[0].Total);
        // Without narrowing, the same runs count every result.
        Assert.Equal(2, Build([r1, r2], cases: inProject).RecentRuns.Count);
    }
}
