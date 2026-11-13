using System.Net;
using System.Net.Http.Json;

namespace QaStudio.IntegrationTests;

[Collection(nameof(ApiTestGroup))]
public class TestCaseTests(ApiFixture api)
{
    private readonly HttpClient _client = api.CreateClient();

    private static string Unique(string prefix = "C") => $"{prefix}{Guid.NewGuid():N}"[..20].ToUpperInvariant();

    private async Task<(ProjectDto Project, SuiteDto Suite)> NewSuiteAsync()
    {
        var project = await (await _client.PostAsJsonAsync("/api/projects", new { code = Unique("P"), name = "Project" })).ReadAsync<ProjectDto>();
        var suite = await (await _client.PostAsJsonAsync("/api/test-suites", new { projectId = project.Id, name = Unique("S") })).ReadAsync<SuiteDto>();
        return (project, suite);
    }

    private async Task<CaseDto> NewCaseAsync(int suiteId, string? id = null)
    {
        var response = await _client.PostAsJsonAsync("/api/test-cases", new { id = id ?? Unique(), testSuiteId = suiteId, title = "Title", steps = new[] { "One", "Two" }, module = "Mod" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<CaseDto>();
    }

    [Fact]
    public async Task A_case_is_created_with_its_place_in_the_hierarchy()
    {
        var (project, suite) = await NewSuiteAsync();
        var created = await NewCaseAsync(suite.Id);
        Assert.Equal(suite.Id, created.TestSuiteId);
        Assert.Equal(suite.Name, created.TestSuiteName);
        Assert.Equal(project.Id, created.ProjectId);
        Assert.Equal(["One", "Two"], created.Steps.Select(s => s.Action));
        Assert.Equal([1, 2], created.Steps.Select(s => s.Order));
    }

    [Fact]
    public async Task An_id_left_out_gets_the_next_free_one()
    {
        var (_, suite) = await NewSuiteAsync();
        var suggested = await (await _client.GetAsync("/api/test-cases/next-id")).ReadAsync<NextId>();
        var response = await _client.PostAsJsonAsync("/api/test-cases", new { testSuiteId = suite.Id, title = "Auto" });
        var created = await response.ReadAsync<CaseDto>();
        Assert.Equal(suggested.Id, created.Id);
    }

    [Fact]
    public async Task A_duplicate_id_is_refused_and_names_the_field()
    {
        var (_, suite) = await NewSuiteAsync();
        var first = await NewCaseAsync(suite.Id);
        var response = await _client.PostAsJsonAsync("/api/test-cases", new { id = first.Id, testSuiteId = suite.Id, title = "Again" });
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var error = await response.ReadErrorAsync();
        Assert.Equal("duplicate-id", error.Error.Code);
        Assert.True(error.Error.Fields!.ContainsKey("id"));
    }

    [Fact]
    public async Task Ids_differing_only_by_case_are_different_cases_as_they_are_in_the_worker()
    {
        var (_, suite) = await NewSuiteAsync();
        var id = Unique("Abc");
        await NewCaseAsync(suite.Id, id);
        var lower = await NewCaseAsync(suite.Id, id.ToLowerInvariant());
        Assert.Equal(id.ToLowerInvariant(), lower.Id);
    }

    [Fact]
    public async Task A_case_needs_an_existing_suite()
    {
        var response = await _client.PostAsJsonAsync("/api/test-cases", new { testSuiteId = 99999, title = "T" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("unknown-suite", (await response.ReadErrorAsync()).Error.Code);
    }

    [Fact]
    public async Task The_list_filters_by_project_suite_text_and_pages()
    {
        var (project, suite) = await NewSuiteAsync();
        var (_, otherSuite) = await NewSuiteAsync();
        var mine = await NewCaseAsync(suite.Id);
        var mine2 = await NewCaseAsync(suite.Id);
        await NewCaseAsync(otherSuite.Id);

        var byProject = await (await _client.GetAsync($"/api/test-cases?projectId={project.Id}")).ReadAsync<CasePageDto>();
        Assert.Equal([mine.Id, mine2.Id], byProject.Items.Select(c => c.Id));
        var bySuite = await (await _client.GetAsync($"/api/test-cases?testSuiteId={otherSuite.Id}")).ReadAsync<CasePageDto>();
        Assert.Equal(1, bySuite.Total);
        var byText = await (await _client.GetAsync($"/api/test-cases?q={mine.Id}")).ReadAsync<CasePageDto>();
        Assert.Equal(mine.Id, Assert.Single(byText.Items).Id);

        var paged = await (await _client.GetAsync($"/api/test-cases?projectId={project.Id}&page=2&pageSize=1")).ReadAsync<CasePageDto>();
        Assert.Equal(2, paged.Total);
        Assert.Equal(mine2.Id, Assert.Single(paged.Items).Id);
        Assert.Equal(2, Assert.Single(paged.Items).Steps.Count);
    }

    [Fact]
    public async Task A_page_size_above_the_limit_is_capped()
    {
        var page = await (await _client.GetAsync("/api/test-cases?pageSize=100000")).ReadAsync<CasePageDto>();
        Assert.Equal(200, page.PageSize);
    }

    [Fact]
    public async Task A_quoted_or_wildcard_search_is_treated_as_plain_text()
    {
        var response = await _client.GetAsync($"/api/test-cases?q={Uri.EscapeDataString("%'; DROP TABLE TestCases; --")}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(0, (await response.ReadAsync<CasePageDto>()).Total);
    }

    [Fact]
    public async Task Updating_changes_content_and_suite_and_keeps_steps_left_out()
    {
        var (_, suite) = await NewSuiteAsync();
        var (_, target) = await NewSuiteAsync();
        var created = await NewCaseAsync(suite.Id);
        var response = await _client.PutAsJsonAsync($"/api/test-cases/{created.Id}", new { testSuiteId = target.Id, title = "Changed", rowVersion = created.RowVersion });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await response.ReadAsync<CaseDto>();
        Assert.Equal("Changed", updated.Title);
        Assert.Equal(target.Id, updated.TestSuiteId);
        Assert.Equal(2, updated.Steps.Count);

        var stale = await _client.PutAsJsonAsync($"/api/test-cases/{created.Id}", new { testSuiteId = target.Id, title = "Stale", rowVersion = created.RowVersion });
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
    }

    [Fact]
    public async Task Deleting_reports_what_was_and_was_not_there()
    {
        var (_, suite) = await NewSuiteAsync();
        var created = await NewCaseAsync(suite.Id);
        var response = await _client.PostAsJsonAsync("/api/test-cases/delete", new { ids = new[] { created.Id, created.Id, "NOPE" } });
        var result = await response.ReadAsync<DeleteResult>();
        Assert.Equal(1, result.Deleted);
        Assert.Equal(1, result.NotFound);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/test-cases/{created.Id}")).StatusCode);
    }

    [Fact]
    public async Task A_save_is_not_lost_when_the_worker_is_down()
    {
        // The fixture points at a port nothing listens on; the case must still be committed and returned.
        var (_, suite) = await NewSuiteAsync();
        var created = await NewCaseAsync(suite.Id);
        Assert.Equal(HttpStatusCode.OK, (await _client.GetAsync($"/api/test-cases/{created.Id}")).StatusCode);
    }

    [Fact]
    public async Task Changes_are_audited()
    {
        var (_, suite) = await NewSuiteAsync();
        var created = await NewCaseAsync(suite.Id);
        var audit = await (await _client.GetAsync("/api/audit?limit=20")).ReadAsync<ListDto<AuditDto>>();
        Assert.Contains(audit.Items, a => a.Action == "inventory.create" && a.Target == created.Id);
    }

    private sealed record NextId(string Id);

    private sealed record DeleteResult(int Deleted, int NotFound);

    private sealed record AuditDto(long Id, string At, string Action, string Target, string Detail);
}

