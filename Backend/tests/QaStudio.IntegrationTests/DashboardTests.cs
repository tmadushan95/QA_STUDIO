using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace QaStudio.IntegrationTests;

/// <summary>
/// The dashboard is served by this API from the database. Runs and scenarios arrive the way the worker sends them (batch
/// operations); the cases and projects are created through the public API.
/// </summary>
[Collection(nameof(ApiTestGroup))]
public class DashboardTests(ApiFixture api)
{
    private readonly HttpClient _client = api.CreateClient();

    private static string Unique(string prefix) => $"{prefix}{Guid.NewGuid():N}"[..20].ToUpperInvariant();

    private static object Run(string id, string createdAt, string status, params object[] cases) =>
        new { id, createdAt, status, environment = "qa", browser = "chromium", workers = 1, cases };

    private static object Result(string caseId, string status, string? message = null) =>
        new { caseId, status, steps = Array.Empty<object>(), artifacts = Array.Empty<object>(), failure = message is null ? null : new { kind = "assertion", message } };

    private Task<HttpResponseMessage> SendAsync(params object[] operations) =>
        api.Worker.PostAsJsonAsync("/internal/persistence/batch", new { operations });

    private async Task<(int ProjectId, int SuiteId)> NewProjectWithSuiteAsync()
    {
        var project = await (await _client.PostAsJsonAsync("/api/projects", new { code = Unique("D"), name = "Dashboarded" })).ReadAsync<ProjectDto>();
        var suite = await (await _client.PostAsJsonAsync("/api/test-suites", new { projectId = project.Id, name = Unique("S") })).ReadAsync<SuiteDto>();
        return (project.Id, suite.Id);
    }

    private async Task<string> NewCaseAsync(int suiteId, string priority)
    {
        var id = Unique("TC_");
        var response = await _client.PostAsJsonAsync("/api/test-cases", new { id, testSuiteId = suiteId, title = $"Case {id}", priority, steps = new[] { "Open" } });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return id;
    }

    [Fact]
    public async Task The_dashboard_counts_the_latest_results_and_the_failures_of_a_projects_cases()
    {
        var (projectId, suiteId) = await NewProjectWithSuiteAsync();
        var failing = await NewCaseAsync(suiteId, "High");
        var passing = await NewCaseAsync(suiteId, "Low");
        var untouched = await NewCaseAsync(suiteId, "Low");
        var elsewhere = Unique("OTHER");

        var runId = Unique("R");
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(
            new { kind = "scenario.upsert", key = passing, slot = "approved", payload = new { caseId = passing, version = 1, status = "approved", scenario = new { schemaVersion = 1, caseId = passing, steps = Array.Empty<object>() } } },
            new { kind = "run.upsert", key = runId, payload = Run(runId, "2030-01-01T00:00:00.000Z", "failed", Result(failing, "failed", "Gate not shown"), Result(passing, "passed"), Result(elsewhere, "failed", "not ours")) })).StatusCode);

        var d = await (await _client.GetAsync($"/api/dashboard?projectId={projectId}")).ReadAsync<DashboardDto>();
        Assert.Equal(new TotalsDto(3, 1, 2), d.Totals);
        Assert.Equal(1, d.Latest.Passed);
        Assert.Equal(1, d.Latest.Failed);
        Assert.Equal(1, d.Latest.NotRun);
        Assert.Equal(0.5, d.Latest.PassRate);
        var failure = Assert.Single(d.HighPriorityFailures);
        Assert.Equal(failing, failure.CaseId);
        Assert.Equal("Gate not shown", failure.Message);
        Assert.Contains(d.Map.SelectMany(m => m.Cells), c => c.Id == passing && c.Status == "passed" && c.Scenario);
        Assert.Contains(d.Map.SelectMany(m => m.Cells), c => c.Id == untouched && c.Status == "notRun");

        // The run is listed with only this project's two results, not the case from elsewhere.
        var recent = Assert.Single(d.RecentRuns, r => r.Id == runId);
        Assert.Equal(2, recent.Total);
        Assert.Equal("qa", recent.Environment);
    }

    [Fact]
    public async Task A_project_with_no_runs_shows_every_case_as_not_run()
    {
        var (projectId, suiteId) = await NewProjectWithSuiteAsync();
        await NewCaseAsync(suiteId, "High");

        var d = await (await _client.GetAsync($"/api/dashboard?projectId={projectId}")).ReadAsync<DashboardDto>();
        Assert.Equal(1, d.Latest.NotRun);
        Assert.Null(d.Latest.PassRate);
        Assert.Empty(d.RecentRuns);
        Assert.Empty(d.Trend);
    }

    [Fact]
    public async Task The_dashboard_is_answered_here_not_forwarded_to_the_worker()
    {
        // The worker is not running in these tests, so a forwarded request would answer 503.
        var response = await _client.GetAsync("/api/dashboard");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await response.ReadAsync<JsonElement>();
        Assert.True(json.TryGetProperty("definitions", out _));
        Assert.True(json.TryGetProperty("mapTruncated", out _));
    }

    private sealed record TotalsDto(int Cases, int WithScenario, int WithoutScenario);

    private sealed record LatestDto(int Passed, int Failed, int Blocked, int NotRun, double? PassRate);

    private sealed record CellDto(string Id, string Status, bool Scenario);

    private sealed record MapDto(string Module, List<CellDto> Cells);

    private sealed record FailureDto(string CaseId, string Title, string? Module, string Priority, string RunId, string Message);

    private sealed record RecentDto(string Id, string Status, string At, string Environment, int Total, double? PassRate);

    private sealed record DashboardDto(
        TotalsDto Totals,
        LatestDto Latest,
        List<MapDto> Map,
        List<JsonElement> Trend,
        List<RecentDto> RecentRuns,
        List<FailureDto> HighPriorityFailures);
}
