using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace QaStudio.IntegrationTests;

/// <summary>The run history is read by this API from the database. Runs arrive the way the worker sends them.</summary>
[Collection(nameof(ApiTestGroup))]
public class RunHistoryTests(ApiFixture api)
{
    private readonly HttpClient _client = api.CreateClient();

    private static string Unique(string prefix) => $"{prefix}{Guid.NewGuid():N}"[..20].ToUpperInvariant();

    private static object Run(string id, string createdAt, string status, params object[] cases) =>
        new { id, createdAt, status, environment = "qa", browser = "chromium", workers = 1, cases, anythingElse = "kept" };

    private static object Result(string caseId, string status) =>
        new { caseId, status, steps = Array.Empty<object>(), artifacts = new[] { "shot.png" } };

    private Task<HttpResponseMessage> SendAsync(params object[] operations) =>
        api.Worker.PostAsJsonAsync("/internal/persistence/batch", new { operations });

    private async Task<(int ProjectId, string CaseId)> NewProjectWithCaseAsync()
    {
        var project = await (await _client.PostAsJsonAsync("/api/projects", new { code = Unique("H"), name = "History" })).ReadAsync<ProjectDto>();
        var suite = await (await _client.PostAsJsonAsync("/api/test-suites", new { projectId = project.Id, name = Unique("S") })).ReadAsync<SuiteDto>();
        var id = Unique("TC_");
        Assert.Equal(HttpStatusCode.Created, (await _client.PostAsJsonAsync("/api/test-cases", new { id, testSuiteId = suite.Id, title = "History case", steps = new[] { "Open" } })).StatusCode);
        return (project.Id, id);
    }

    [Fact]
    public async Task A_stored_run_is_listed_and_read_with_a_summary_and_everything_the_worker_stored()
    {
        var id = Unique("R");
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(
            new { kind = "run.upsert", key = id, payload = Run(id, "2031-01-01T00:00:00.000Z", "failed", Result("TC_1", "passed"), Result("TC_2", "failed")) })).StatusCode);

        var one = await (await _client.GetAsync($"/api/runs/{id}")).ReadAsync<JsonElement>();
        Assert.Equal(id, one.GetProperty("id").GetString());
        Assert.Equal("kept", one.GetProperty("anythingElse").GetString());
        Assert.Equal(2, one.GetProperty("summary").GetProperty("total").GetInt32());
        Assert.Equal(0.5, one.GetProperty("summary").GetProperty("passRate").GetDouble());
        Assert.Equal("shot.png", one.GetProperty("cases")[0].GetProperty("artifacts")[0].GetString());

        var list = await (await _client.GetAsync("/api/runs")).ReadAsync<JsonElement>();
        var items = list.GetProperty("items").EnumerateArray().ToList();
        Assert.Contains(items, r => r.GetProperty("id").GetString() == id && r.GetProperty("summary").GetProperty("counts").GetProperty("failed").GetInt32() == 1);
        // Newest first.
        var times = items.Select(r => r.GetProperty("createdAt").GetString()!).ToList();
        Assert.Equal(times.OrderByDescending(t => t, StringComparer.Ordinal), times);
    }

    [Fact]
    public async Task An_unknown_run_is_a_404_in_the_apis_error_shape()
    {
        var response = await _client.GetAsync($"/api/runs/{Unique("NOPE")}");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("unknown-run", (await response.ReadErrorAsync()).Error.Code);
    }

    [Fact]
    public async Task A_projects_list_keeps_only_its_cases_results_and_drops_runs_with_none()
    {
        var (projectId, mine) = await NewProjectWithCaseAsync();
        var both = Unique("R");
        var elsewhere = Unique("R");
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(
            new { kind = "run.upsert", key = both, payload = Run(both, "2032-01-01T00:00:00.000Z", "failed", Result(mine, "passed"), Result("SOMEONE_ELSE", "failed")) },
            new { kind = "run.upsert", key = elsewhere, payload = Run(elsewhere, "2032-01-02T00:00:00.000Z", "failed", Result("SOMEONE_ELSE", "failed")) })).StatusCode);

        var list = await (await _client.GetAsync($"/api/runs?projectId={projectId}")).ReadAsync<JsonElement>();
        var items = list.GetProperty("items").EnumerateArray().ToList();
        var run = Assert.Single(items);
        Assert.Equal(both, run.GetProperty("id").GetString());
        Assert.Equal(1, run.GetProperty("cases").GetArrayLength());
        Assert.Equal(mine, run.GetProperty("cases")[0].GetProperty("caseId").GetString());
        Assert.Equal(1, run.GetProperty("summary").GetProperty("counts").GetProperty("passed").GetInt32());
    }

    [Fact]
    public async Task The_history_is_answered_here_but_the_reports_still_go_to_the_worker()
    {
        Assert.Equal(HttpStatusCode.OK, (await _client.GetAsync("/api/runs")).StatusCode);
        // The worker is not running in these tests, so a request that is forwarded answers 503.
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await _client.GetAsync("/api/runs/anything/report.html")).StatusCode);
    }
}
