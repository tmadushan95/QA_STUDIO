using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace QaStudio.IntegrationTests;

/// <summary>
/// Parameter values are owned by this API: saved as rows, read back as views, filled automatically, supplied to runs through
/// the worker's internal routes, and removed with their case or project. The worker is not running in these tests, so asking
/// the AI fails and names are guessed, which is also how "the AI is off" behaves.
/// </summary>
[Collection(nameof(ApiTestGroup))]
public class ParametersTests(ApiFixture api)
{
    private readonly HttpClient _client = api.CreateClient();

    private static string Unique(string prefix) => $"{prefix}{Guid.NewGuid():N}"[..20].ToUpperInvariant();

    private Task<HttpResponseMessage> SendAsync(params object[] operations) =>
        api.Worker.PostAsJsonAsync("/internal/persistence/batch", new { operations });

    private static object Scenario(string caseId, string status, params string[] values) => new
    {
        caseId,
        version = 1,
        status,
        scenario = new { schemaVersion = 1, caseId, steps = values.Select(v => new { action = "fill", @params = new { value = v } }).ToArray() },
    };

    private async Task<int> NewProjectAsync() =>
        (await (await _client.PostAsJsonAsync("/api/projects", new { code = Unique("Q"), name = "Parametered" })).ReadAsync<ProjectDto>()).Id;

    private async Task<(int ProjectId, string CaseId)> NewCaseAsync(int? projectId = null, params string[] reads)
    {
        var project = projectId ?? await NewProjectAsync();
        var suite = await (await _client.PostAsJsonAsync("/api/test-suites", new { projectId = project, name = Unique("S") })).ReadAsync<SuiteDto>();
        var id = Unique("TC_");
        Assert.Equal(HttpStatusCode.Created, (await _client.PostAsJsonAsync("/api/test-cases", new { id, testSuiteId = suite.Id, title = "Parametered case", steps = new[] { "Open the page", "Fill the form" } })).StatusCode);
        if (reads.Length > 0)
        {
            Assert.Equal(HttpStatusCode.OK, (await SendAsync(new { kind = "scenario.upsert", key = id, slot = "approved", payload = Scenario(id, "approved", reads) })).StatusCode);
        }

        return (project, id);
    }

    private async Task<JsonElement> GetAsync(string url) => await (await _client.GetAsync(url)).ReadAsync<JsonElement>();

    private async Task<HttpResponseMessage> PutValuesAsync(string url, object values) =>
        await _client.PutAsJsonAsync(url, new { values });

    [Fact]
    public async Task A_case_shows_what_its_steps_read_from_the_draft_first_and_where_each_value_comes_from()
    {
        var (projectId, caseId) = await NewCaseAsync(null, "{{data.projectCode}}");
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(
            new { kind = "scenario.upsert", key = caseId, slot = "draft", payload = Scenario(caseId, "validated", "{{data.projectCode}}", "{{data.role}}") })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await PutValuesAsync($"/api/parameters/common/{projectId}", new { projectCode = "PRJ-COMMON" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await PutValuesAsync($"/api/parameters/{caseId}", new { role = "Viewer" })).StatusCode);

        var view = await GetAsync($"/api/parameters/{caseId}");
        Assert.Equal(projectId, view.GetProperty("projectId").GetInt32());
        Assert.Equal(0, view.GetProperty("missing").GetArrayLength());
        var items = view.GetProperty("items").EnumerateArray().ToList();
        // The draft adds "role", which the approved steps do not read.
        Assert.Equal(["projectCode", "role"], items.Select(i => i.GetProperty("name").GetString()));
        Assert.Equal("common", items[0].GetProperty("source").GetString());
        Assert.Equal("PRJ-COMMON", items[0].GetProperty("common").GetString());
        Assert.Equal("case", items[1].GetProperty("source").GetString());
        Assert.Equal("Viewer", items[1].GetProperty("value").GetString());
        Assert.False(items[1].TryGetProperty("common", out _));
    }

    [Fact]
    public async Task Saving_replaces_the_cases_values_trims_them_and_returns_the_new_view()
    {
        var (_, caseId) = await NewCaseAsync(null, "{{data.a}} {{data.b}}");
        var saved = await (await PutValuesAsync($"/api/parameters/{caseId}", new { a = " one ", b = "two", extra = "kept although unread" })).ReadAsync<JsonElement>();
        Assert.Equal("one", saved.GetProperty("items")[0].GetProperty("value").GetString());
        Assert.Contains(saved.GetProperty("items").EnumerateArray(), i => i.GetProperty("name").GetString() == "extra" && !i.GetProperty("used").GetBoolean());

        // Saving again replaces the whole set: "b" is cleared, "extra" is gone, "a" changes.
        var again = await (await PutValuesAsync($"/api/parameters/{caseId}", new { a = "uno", b = "", c = "new" })).ReadAsync<JsonElement>();
        var names = again.GetProperty("items").EnumerateArray().ToDictionary(i => i.GetProperty("name").GetString()!, i => i.GetProperty("value").GetString());
        Assert.Equal("uno", names["a"]);
        Assert.Equal("new", names["c"]);
        Assert.DoesNotContain("extra", names.Keys);
        Assert.Equal(["b"], again.GetProperty("missing").EnumerateArray().Select(m => m.GetString()));
    }

    [Fact]
    public async Task A_bad_name_is_refused_with_the_field_named_and_an_unknown_case_is_a_404()
    {
        var (_, caseId) = await NewCaseAsync(null, "{{data.a}}");
        var bad = await PutValuesAsync($"/api/parameters/{caseId}", new Dictionary<string, string> { ["1x"] = "a" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var error = (await bad.ReadErrorAsync()).Error;
        Assert.Equal("invalid-parameters", error.Code);
        Assert.Contains("values.1x", error.Fields!.Keys);

        Assert.Equal(HttpStatusCode.NotFound, (await PutValuesAsync($"/api/parameters/{Unique("NOPE")}", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await PutValuesAsync("/api/parameters/common/987654", new { a = "b" })).StatusCode);
    }

    [Fact]
    public async Task A_cases_own_value_overrides_the_common_one_and_clearing_it_goes_back()
    {
        var (projectId, caseId) = await NewCaseAsync(null, "{{data.projectCode}}");
        var (_, otherId) = await NewCaseAsync(projectId, "{{data.projectCode}}");
        await PutValuesAsync($"/api/parameters/common/{projectId}", new { projectCode = "COMMON" });
        await PutValuesAsync($"/api/parameters/{caseId}", new { projectCode = "OWN" });

        var common = await GetAsync($"/api/parameters/common/{projectId}");
        var item = common.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("name").GetString() == "projectCode");
        Assert.Equal((2, 1), (item.GetProperty("usedBy").GetInt32(), item.GetProperty("overriddenBy").GetInt32()));

        var effective = await api.Worker.PostAsJsonAsync("/internal/persistence/parameters/effective", new { caseIds = new[] { caseId, otherId } });
        var values = (await effective.ReadAsync<JsonElement>()).GetProperty("items");
        Assert.Equal("OWN", values.GetProperty(caseId).GetProperty("projectCode").GetString());
        Assert.Equal("COMMON", values.GetProperty(otherId).GetProperty("projectCode").GetString());

        await PutValuesAsync($"/api/parameters/{caseId}", new { projectCode = "" });
        var cleared = await GetAsync($"/api/parameters/{caseId}");
        Assert.Equal("common", cleared.GetProperty("items")[0].GetProperty("source").GetString());
    }

    [Fact]
    public async Task Common_values_never_reach_a_case_of_another_project()
    {
        var (projectA, caseA) = await NewCaseAsync(null, "{{data.projectCode}}");
        var (_, caseB) = await NewCaseAsync(null, "{{data.projectCode}}");
        await PutValuesAsync($"/api/parameters/common/{projectA}", new { projectCode = "A-ONLY" });
        var values = (await (await api.Worker.PostAsJsonAsync("/internal/persistence/parameters/effective", new { caseIds = new[] { caseA, caseB } })).ReadAsync<JsonElement>()).GetProperty("items");
        Assert.Equal("A-ONLY", values.GetProperty(caseA).GetProperty("projectCode").GetString());
        Assert.Empty(values.GetProperty(caseB).EnumerateObject());
    }

    [Fact]
    public async Task The_summary_lists_only_cases_that_need_values_and_counts_common_values_as_set()
    {
        var (projectId, caseId) = await NewCaseAsync(null, "{{data.projectCode}} {{data.role}}");
        await PutValuesAsync($"/api/parameters/common/{projectId}", new { projectCode = "PRJ" });
        var summary = await GetAsync("/api/parameters");
        var row = summary.GetProperty("items").EnumerateArray().Single(r => r.GetProperty("caseId").GetString() == caseId);
        Assert.Equal(2, row.GetProperty("needed").GetInt32());
        Assert.Equal(["role"], row.GetProperty("missing").EnumerateArray().Select(m => m.GetString()));
    }

    [Fact]
    public async Task A_case_that_does_not_exist_has_no_parameters_rather_than_an_error()
    {
        var view = await GetAsync($"/api/parameters/{Unique("NOPE")}");
        Assert.Equal(0, view.GetProperty("items").GetArrayLength());
        Assert.False(view.TryGetProperty("projectId", out _));
    }

    [Fact]
    public async Task Saving_is_written_to_the_audit_trail()
    {
        var (projectId, caseId) = await NewCaseAsync(null, "{{data.a}}");
        await PutValuesAsync($"/api/parameters/{caseId}", new { a = "1" });
        await PutValuesAsync($"/api/parameters/common/{projectId}", new { a = "2" });
        var items = (await GetAsync("/api/audit?limit=100")).GetProperty("items").EnumerateArray().ToList();
        Assert.Contains(items, a => a.GetProperty("action").GetString() == "parameters.update" && a.GetProperty("target").GetString() == caseId);
        Assert.Contains(items, a => a.GetProperty("action").GetString() == "parameters.common" && a.GetProperty("target").GetString() == $"project {projectId}");
    }

    [Fact]
    public async Task Suggestions_come_from_the_retired_test_data_first_then_a_guess_and_never_for_a_password()
    {
        var (projectId, caseId) = await NewCaseAsync(null, "{{data.projectCode}} {{data.ownerEmail}} {{data.password}}");
        await SendAsync(new { kind = "config.upsert", key = "legacy-test-data", payload = new { projectCode = "LEGACY-7" } });

        var suggest = await (await _client.PostAsJsonAsync($"/api/parameters/{caseId}/suggest", new { ai = true })).ReadAsync<JsonElement>();
        var items = suggest.GetProperty("items").EnumerateArray().Select(i => (i.GetProperty("name").GetString(), i.GetProperty("source").GetString())).ToList();
        // The worker (and so the AI) is not reachable here, so the email is guessed.
        Assert.Equal([("projectCode", "legacy"), ("ownerEmail", "guess")], items);

        var common = await (await _client.PostAsJsonAsync($"/api/parameters/common/{projectId}/suggest", new { })).ReadAsync<JsonElement>();
        Assert.Contains(common.GetProperty("items").EnumerateArray(), i => i.GetProperty("name").GetString() == "projectCode" && i.GetProperty("source").GetString() == "legacy");
        Assert.DoesNotContain(common.GetProperty("items").EnumerateArray(), i => i.GetProperty("name").GetString() == "password");
        await SendAsync(new { kind = "config.upsert", key = "legacy-test-data", payload = new { } });
    }

    [Fact]
    public async Task Auto_fill_keeps_what_a_person_set_saves_the_rest_and_reports_what_is_still_missing()
    {
        var (_, caseId) = await NewCaseAsync(null, "{{data.projectCode}} {{data.ownerEmail}} {{data.password}}");
        var (_, setId) = await NewCaseAsync(null, "{{data.projectCode}}");
        await PutValuesAsync($"/api/parameters/{setId}", new { projectCode = "MINE" });

        var response = await _client.PostAsJsonAsync("/api/parameters/auto", new { caseIds = new[] { caseId, setId, Unique("GONE") }, ai = false });
        var result = await response.ReadAsync<JsonElement>();
        Assert.Equal(1, result.GetProperty("configured").GetInt32());
        Assert.Equal(2, result.GetProperty("filled").GetInt32());
        var left = Assert.Single(result.GetProperty("stillMissing").EnumerateArray());
        Assert.Equal(caseId, left.GetProperty("caseId").GetString());
        Assert.Equal(3, left.GetProperty("needed").GetInt32());
        Assert.Equal(["password"], left.GetProperty("missing").EnumerateArray().Select(m => m.GetString()));

        var untouched = await GetAsync($"/api/parameters/{setId}");
        Assert.Equal("MINE", untouched.GetProperty("items")[0].GetProperty("value").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.PostAsJsonAsync("/api/parameters/auto", new { caseIds = Array.Empty<string>() })).StatusCode);
    }

    [Fact]
    public async Task Deleting_a_case_deletes_its_values_and_deleting_a_project_deletes_its_common_values()
    {
        var (projectId, caseId) = await NewCaseAsync(null, "{{data.a}}");
        await PutValuesAsync($"/api/parameters/{caseId}", new { a = "1" });
        await PutValuesAsync($"/api/parameters/common/{projectId}", new { a = "2" });

        Assert.Equal(HttpStatusCode.OK, (await _client.PostAsJsonAsync("/api/test-cases/delete", new { ids = new[] { caseId } })).StatusCode);
        var export = (await (await api.Worker.GetAsync("/internal/persistence/parameters/export")).ReadAsync<JsonElement>()).GetProperty("items");
        Assert.False(export.TryGetProperty(caseId, out _));

        var suites = (await GetAsync($"/api/test-suites?projectId={projectId}")).GetProperty("items").EnumerateArray().Select(s => s.GetProperty("id").GetInt32()).ToList();
        foreach (var suite in suites)
        {
            Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/test-suites/{suite}")).StatusCode);
        }

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/projects/{projectId}")).StatusCode);
        var common = await GetAsync($"/api/parameters/common/{projectId}");
        Assert.Equal(0, common.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task The_worker_can_export_import_and_clear_the_values_with_the_internal_secret_only()
    {
        var (_, caseId) = await NewCaseAsync(null, "{{data.a}}");
        using var anonymous = api.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/internal/persistence/parameters/export")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/internal/persistence/parameters/effective", new { caseIds = new[] { caseId } })).StatusCode);

        // A backup's values go back exactly as they were, replacing that case's values and leaving others alone.
        await PutValuesAsync($"/api/parameters/{caseId}", new { a = "before", z = "dropped on restore" });
        var imported = await (await api.Worker.PostAsJsonAsync("/internal/persistence/parameters/import", new { values = new Dictionary<string, Dictionary<string, string>> { [caseId] = new() { ["a"] = "restored" } } })).ReadAsync<JsonElement>();
        Assert.Equal(1, imported.GetProperty("imported").GetInt32());
        var view = await GetAsync($"/api/parameters/{caseId}");
        Assert.Equal(["a"], view.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("name").GetString()));
        Assert.Equal("restored", view.GetProperty("items")[0].GetProperty("value").GetString());

        var cleared = await (await api.Worker.DeleteAsync("/internal/persistence/parameters")).ReadAsync<JsonElement>();
        Assert.True(cleared.GetProperty("deleted").GetInt32() >= 1);
        // The step still reads "a", but it has no value now.
        var after = (await GetAsync($"/api/parameters/{caseId}")).GetProperty("items")[0];
        Assert.Equal("missing", after.GetProperty("source").GetString());
    }

    [Fact]
    public async Task The_worker_can_ask_for_auto_fill_for_the_azure_pipeline()
    {
        var (_, caseId) = await NewCaseAsync(null, "{{data.projectCode}}");
        var result = await (await api.Worker.PostAsJsonAsync("/internal/persistence/parameters/auto", new { caseIds = new[] { caseId }, ai = false })).ReadAsync<JsonElement>();
        Assert.Equal(1, result.GetProperty("configured").GetInt32());
        Assert.Equal(0, result.GetProperty("stillMissing").GetArrayLength());
    }
}
