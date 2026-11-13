using System.Text.Json;
using QaStudio.Application.Features.Parameters.Common;

namespace QaStudio.UnitTests;

/// <summary>
/// The parameter rules the worker held when it served the views (two layers: the case's own value, then the project's
/// common value, else missing), kept as tests so the move to .NET is shown to change nothing.
/// </summary>
public class ParameterViewsTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private static readonly IReadOnlyDictionary<string, string> None = new Dictionary<string, string>();

    private static string Scenario(params string[] values) => JsonSerializer.Serialize(new
    {
        caseId = "TC_1",
        scenario = new { steps = values.Select(v => new { action = "fill", @params = new { value = v } }).ToArray() },
    });

    [Fact]
    public void The_names_a_scenario_reads_come_in_first_seen_order_each_once()
    {
        var json = Scenario("{{data.projectCode}}", "{{ data.ownerEmail }} and {{data.password}}", "{{data.projectCode}} again");
        Assert.Equal(["projectCode", "ownerEmail", "password"], ParameterViews.NeededNames(json));
    }

    [Fact]
    public void Names_are_found_inside_nested_parameters_but_not_in_keys_or_other_fields()
    {
        var json = """
            {"caseId":"TC_1","note":"{{data.ignored}}","scenario":{"steps":[
              {"action":"click","params":{"target":{"role":"button","name":"{{data.deep}}","within":{"text":"{{data.deeper}}"}},"{{data.key}}":1}},
              {"action":"open","params":{"paths":["/a/{{data.inList}}"]}}]}}
            """;
        Assert.Equal(["deep", "deeper", "inList"], ParameterViews.NeededNames(json));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("{}")]
    public void A_missing_or_unreadable_scenario_reads_no_parameters(string? json) =>
        Assert.Empty(ParameterViews.NeededNames(json));

    [Fact]
    public void A_case_lists_what_its_steps_read_and_says_which_are_missing()
    {
        var view = ParameterViews.ForCase("TC_1", 7, ["projectCode", "ownerEmail", "password"], None, None);
        Assert.Equal(7, view.ProjectId);
        Assert.Equal(["projectCode", "ownerEmail", "password"], view.Missing);
        Assert.All(view.Items, i =>
        {
            Assert.Equal("missing", i.Source);
            Assert.True(i.Used);
            Assert.Equal(string.Empty, i.Value);
        });
    }

    [Fact]
    public void A_common_value_is_inherited_and_the_cases_own_value_wins_over_it()
    {
        var common = new Dictionary<string, string> { ["projectCode"] = "PRJ-COMMON", ["role"] = "Admin" };
        var inherited = ParameterViews.ForCase("TC_1", 7, ["projectCode"], None, common);
        Assert.Equal(new ParameterItem("projectCode", string.Empty, "PRJ-COMMON", "common", true), inherited.Items[0]);
        Assert.Empty(inherited.Missing);

        var overridden = ParameterViews.ForCase("TC_1", 7, ["projectCode"], new Dictionary<string, string> { ["projectCode"] = "PRJ-OWN" }, common);
        Assert.Equal(new ParameterItem("projectCode", "PRJ-OWN", "PRJ-COMMON", "case", true), overridden.Items[0]);

        // An empty own value means "no own value", so the common one is used again.
        var cleared = ParameterViews.ForCase("TC_1", 7, ["projectCode"], new Dictionary<string, string> { ["projectCode"] = string.Empty }, common);
        Assert.Equal("common", cleared.Items[0].Source);
    }

    [Fact]
    public void A_value_the_steps_no_longer_read_is_kept_and_marked_unused()
    {
        var view = ParameterViews.ForCase("TC_1", null, ["a"], new Dictionary<string, string> { ["old"] = "kept", ["a"] = "x" }, None);
        Assert.Equal(["a", "old"], view.Items.Select(i => i.Name));
        Assert.False(view.Items[1].Used);
        Assert.Null(view.ProjectId);
        Assert.Empty(view.Missing);
    }

    [Fact]
    public void The_json_leaves_out_what_is_not_there_as_the_web_app_expects()
    {
        var json = JsonSerializer.Serialize(ParameterViews.ForCase("TC_1", null, ["a"], None, None), Web);
        Assert.DoesNotContain("projectId", json, StringComparison.Ordinal);
        Assert.DoesNotContain("\"common\"", json, StringComparison.Ordinal);
        Assert.Contains("\"source\":\"missing\"", json, StringComparison.Ordinal);
    }

    [Fact]
    public void The_summary_leaves_out_cases_that_need_nothing_and_counts_common_values_as_set()
    {
        var common = new Dictionary<int, IReadOnlyDictionary<string, string>> { [7] = new Dictionary<string, string> { ["projectCode"] = "PRJ" } };
        var own = new Dictionary<string, IReadOnlyDictionary<string, string>> { ["TC_2"] = new Dictionary<string, string> { ["role"] = "Viewer" } };
        var rows = ParameterViews.Summary(
            [("TC_1", 7, ["projectCode", "role"]), ("TC_2", 7, ["projectCode", "role"]), ("TC_3", 7, []), ("TC_4", 8, ["projectCode"])],
            own,
            common);
        Assert.Equal(
            [new("TC_1", 2, ["role"]), new("TC_2", 2, []), new("TC_4", 1, ["projectCode"])],
            rows,
            new SummaryComparer());
    }

    [Fact]
    public void A_projects_common_list_counts_who_uses_and_overrides_each_name_and_is_sorted()
    {
        var own = new Dictionary<string, IReadOnlyDictionary<string, string>> { ["TC_2"] = new Dictionary<string, string> { ["role"] = "Viewer" } };
        var view = ParameterViews.ForProject(
            7,
            [("TC_1", ["projectCode"]), ("TC_2", ["projectCode", "role"])],
            own,
            new Dictionary<string, string> { ["zeta"] = "kept" });
        Assert.Equal(
            [new CommonItem("projectCode", string.Empty, 2, 0), new CommonItem("role", string.Empty, 1, 1), new CommonItem("zeta", "kept", 0, 0)],
            view.Items);
    }

    [Fact]
    public void The_retired_test_data_block_reads_back_flat_and_a_broken_one_is_empty()
    {
        Assert.Equal("x", ParameterViews.ParseFlat("""{"a":"x"}""")["a"]);
        Assert.Empty(ParameterViews.ParseFlat(null));
        Assert.Empty(ParameterViews.ParseFlat("[1,2]"));
    }

    private sealed class SummaryComparer : IEqualityComparer<ParameterSummaryRow>
    {
        public bool Equals(ParameterSummaryRow? x, ParameterSummaryRow? y) =>
            x is not null && y is not null && x.CaseId == y.CaseId && x.Needed == y.Needed && x.Missing.SequenceEqual(y.Missing);

        public int GetHashCode(ParameterSummaryRow obj) => obj.CaseId.GetHashCode(StringComparison.Ordinal);
    }
}
