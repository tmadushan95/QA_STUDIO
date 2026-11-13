using System.Net;
using System.Net.Http.Json;

namespace QaStudio.IntegrationTests;

[Collection(nameof(ApiTestGroup))]
public class MasterDataTests(ApiFixture api)
{
    private readonly HttpClient _client = api.CreateClient();

    private static string Unique(string prefix) => $"{prefix}{Guid.NewGuid():N}"[..20].ToUpperInvariant();

    private async Task<ProjectDto> NewProjectAsync()
    {
        var response = await _client.PostAsJsonAsync("/api/projects", new { code = Unique("P"), name = "Project" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<ProjectDto>();
    }

    private async Task<SuiteDto> NewSuiteAsync(int projectId, string? name = null)
    {
        var response = await _client.PostAsJsonAsync("/api/test-suites", new { projectId, name = name ?? Unique("S") });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<SuiteDto>();
    }

    [Fact]
    public async Task A_fresh_database_has_somewhere_to_file_test_cases()
    {
        var projects = await (await _client.GetAsync("/api/projects")).ReadAsync<ListDto<ProjectDto>>();
        var general = Assert.Single(projects.Items, p => p.Code == "GENERAL");
        var suites = await (await _client.GetAsync($"/api/test-suites?projectId={general.Id}")).ReadAsync<ListDto<SuiteDto>>();
        Assert.Contains(suites.Items, s => s.Name == "Unassigned");
    }

    [Fact]
    public async Task A_project_can_be_created_changed_read_and_deleted()
    {
        var project = await NewProjectAsync();
        var update = await _client.PutAsJsonAsync($"/api/projects/{project.Id}", new { code = project.Code, name = "Renamed", isActive = false, rowVersion = project.RowVersion });
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        var read = await (await _client.GetAsync($"/api/projects/{project.Id}")).ReadAsync<ProjectDto>();
        Assert.Equal("Renamed", read.Name);
        Assert.False(read.IsActive);
        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/projects/{project.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/projects/{project.Id}")).StatusCode);
    }

    [Fact]
    public async Task A_duplicate_project_code_is_refused_ignoring_case_and_names_the_field()
    {
        var project = await NewProjectAsync();
        var response = await _client.PostAsJsonAsync("/api/projects", new { code = project.Code.ToLowerInvariant(), name = "Other" });
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var error = await response.ReadErrorAsync();
        Assert.Equal("duplicate-code", error.Error.Code);
        Assert.True(error.Error.Fields!.ContainsKey("code"));
    }

    [Fact]
    public async Task Invalid_input_gets_a_message_per_field()
    {
        var response = await _client.PostAsJsonAsync("/api/projects", new { code = "has space", name = "" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var error = await response.ReadErrorAsync();
        Assert.Equal("invalid-request", error.Error.Code);
        Assert.Contains("code", error.Error.Fields!.Keys);
        Assert.Contains("name", error.Error.Fields.Keys);
    }

    [Fact]
    public async Task Malformed_json_gets_the_normal_error_shape()
    {
        using var content = new StringContent("{not json", System.Text.Encoding.UTF8, "application/json");
        var response = await _client.PostAsync("/api/projects", content);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("bad-request", (await response.ReadErrorAsync()).Error.Code);
    }

    [Fact]
    public async Task A_save_based_on_stale_data_is_refused_so_nobody_overwrites_anyone()
    {
        var project = await NewProjectAsync();
        var first = await _client.PutAsJsonAsync($"/api/projects/{project.Id}", new { code = project.Code, name = "First", rowVersion = project.RowVersion });
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var second = await _client.PutAsJsonAsync($"/api/projects/{project.Id}", new { code = project.Code, name = "Second", rowVersion = project.RowVersion });
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        Assert.Equal("changed-since-opened", (await second.ReadErrorAsync()).Error.Code);
    }

    [Fact]
    public async Task A_project_with_suites_cannot_be_deleted()
    {
        var project = await NewProjectAsync();
        await NewSuiteAsync(project.Id);
        var response = await _client.DeleteAsync($"/api/projects/{project.Id}");
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("project-has-suites", (await response.ReadErrorAsync()).Error.Code);
    }

    [Fact]
    public async Task Suite_names_are_unique_within_a_project_but_not_across_projects()
    {
        var one = await NewProjectAsync();
        var two = await NewProjectAsync();
        await NewSuiteAsync(one.Id, "Login");
        await NewSuiteAsync(two.Id, "Login");
        var duplicate = await _client.PostAsJsonAsync("/api/test-suites", new { projectId = one.Id, name = "login" });
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
        Assert.Equal("duplicate-suite", (await duplicate.ReadErrorAsync()).Error.Code);
    }

    [Fact]
    public async Task A_suite_needs_an_existing_project()
    {
        var response = await _client.PostAsJsonAsync("/api/test-suites", new { projectId = 99999, name = "Orphan" });
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task A_suite_holding_test_cases_cannot_be_deleted_until_they_are_moved()
    {
        var project = await NewProjectAsync();
        var suite = await NewSuiteAsync(project.Id);
        var other = await NewSuiteAsync(project.Id);
        var created = await (await _client.PostAsJsonAsync("/api/test-cases", new { id = Unique("C"), testSuiteId = suite.Id, title = "T" })).ReadAsync<CaseDto>();

        var refused = await _client.DeleteAsync($"/api/test-suites/{suite.Id}");
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("suite-has-cases", (await refused.ReadErrorAsync()).Error.Code);

        await _client.PostAsJsonAsync("/api/test-cases/move", new { ids = new[] { created.Id }, testSuiteId = other.Id });
        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/test-suites/{suite.Id}")).StatusCode);
    }

    [Fact]
    public async Task The_cached_lists_show_a_change_immediately()
    {
        await _client.GetAsync("/api/projects"); // fills the cache
        var project = await NewProjectAsync();
        var list = await (await _client.GetAsync("/api/projects")).ReadAsync<ListDto<ProjectDto>>();
        Assert.Contains(list.Items, p => p.Id == project.Id);
    }
}

