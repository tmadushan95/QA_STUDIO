using System.Text.Json.Nodes;
using QaStudio.Application.Features.Runs.Common;

namespace QaStudio.UnitTests;

/// <summary>
/// The rules the worker applied when it served the run history (a summary on every run; a list for one project keeps only
/// that project's results), kept as tests so the move to .NET is shown to change nothing.
/// </summary>
public class RunDocumentsTests
{
    private static JsonObject Run(string id, params (string Case, string Status)[] results) => new()
    {
        ["id"] = id,
        ["status"] = "failed",
        ["environment"] = "qa",
        ["cases"] = new JsonArray([.. results.Select(r => (JsonNode)new JsonObject { ["caseId"] = r.Case, ["status"] = r.Status, ["extra"] = "kept" })]),
        ["somethingNew"] = "passes through",
    };

    [Fact]
    public void The_summary_counts_every_status_and_the_pass_rate_ignores_blocked_and_cancelled()
    {
        var run = RunDocuments.WithSummary(Run("r1", ("A", "passed"), ("B", "passed"), ("C", "failed"), ("D", "blocked"), ("E", "cancelled")));
        var summary = run["summary"]!;
        Assert.Equal(5, (int)summary["total"]!);
        Assert.Equal(2, (int)summary["counts"]!["passed"]!);
        Assert.Equal(1, (int)summary["counts"]!["failed"]!);
        Assert.Equal(1, (int)summary["counts"]!["blocked"]!);
        Assert.Equal(1, (int)summary["counts"]!["cancelled"]!);
        Assert.Equal(0, (int)summary["counts"]!["queued"]!);
        Assert.Equal(2d / 3, (double)summary["passRate"]!, 6);
    }

    [Fact]
    public void The_pass_rate_is_null_when_nothing_executed_and_fields_the_api_does_not_know_pass_through()
    {
        var run = RunDocuments.WithSummary(Run("r1", ("A", "blocked"), ("B", "running")));
        Assert.Null(run["summary"]!["passRate"]);
        Assert.Equal("passes through", (string)run["somethingNew"]!);
        Assert.Equal("kept", (string)run["cases"]![0]!["extra"]!);
    }

    [Fact]
    public void A_stored_summary_is_replaced_not_trusted()
    {
        var run = Run("r1", ("A", "passed"));
        run["summary"] = new JsonObject { ["total"] = 99 };
        Assert.Equal(1, (int)RunDocuments.WithSummary(run)["summary"]!["total"]!);
    }

    [Fact]
    public void Narrowing_keeps_only_the_results_of_the_given_cases_and_leaves_the_original_alone()
    {
        var run = Run("r1", ("A", "passed"), ("B", "failed"), ("C", "passed"));
        var narrowed = RunDocuments.Narrow(run, new HashSet<string> { "A", "C" });
        Assert.NotNull(narrowed);
        Assert.Equal(["A", "C"], narrowed["cases"]!.AsArray().Select(c => (string)c!["caseId"]!));
        Assert.Equal("passes through", (string)narrowed["somethingNew"]!);
        Assert.Equal(3, run["cases"]!.AsArray().Count);
    }

    [Fact]
    public void A_run_with_none_of_the_cases_is_dropped()
    {
        Assert.Null(RunDocuments.Narrow(Run("r1", ("B", "failed")), new HashSet<string> { "A" }));
    }
}
