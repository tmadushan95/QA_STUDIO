using System.Net;
using System.Net.Http.Json;

namespace QaStudio.IntegrationTests;

[Collection(nameof(ApiTestGroup))]
public class ProjectVersionTests(ApiFixture api)
{
    private readonly HttpClient _client = api.CreateClient();

    private static string Unique(string prefix) => $"{prefix}{Guid.NewGuid():N}"[..20].ToUpperInvariant();

    private async Task<(int ProjectId, int SuiteId)> NewProjectWithSuiteAsync()
    {
        var project = await (await _client.PostAsJsonAsync("/api/projects", new { code = Unique("P"), name = "Versioned" })).ReadAsync<ProjectDto>();
        var suite = await (await _client.PostAsJsonAsync("/api/test-suites", new { projectId = project.Id, name = Unique("S") })).ReadAsync<SuiteDto>();
        return (project.Id, suite.Id);
    }

    private async Task<VersionDto> NewVersionAsync(int projectId, string name, bool isCurrent = false)
    {
        var response = await _client.PostAsJsonAsync("/api/project-versions", new { projectId, name, releaseDate = "2026-12-01", isCurrent });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<VersionDto>();
    }

    private async Task<CaseDto> NewCaseAsync(int suiteId)
    {
        var response = await _client.PostAsJsonAsync("/api/test-cases", new { id = Unique("TC_"), testSuiteId = suiteId, title = "Versioned case", steps = new[] { "Open" } });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<CaseDto>();
    }

    [Fact]
    public async Task A_version_can_be_created_listed_changed_and_deleted()
    {
        var (projectId, _) = await NewProjectWithSuiteAsync();
        var version = await NewVersionAsync(projectId, "1.0");
        Assert.Equal("1.0", version.Name);
        Assert.Equal("2026-12-01", version.ReleaseDate);

        var list = await (await _client.GetAsync($"/api/project-versions?projectId={projectId}")).ReadAsync<ListDto<VersionDto>>();
        Assert.Single(list.Items, v => v.Id == version.Id);

        var update = await _client.PutAsJsonAsync($"/api/project-versions/{version.Id}", new { name = "1.0.1", isCurrent = true, isActive = true, rowVersion = version.RowVersion });
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        Assert.True((await update.ReadAsync<VersionDto>()).IsCurrent);

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/project-versions/{version.Id}")).StatusCode);
        list = await (await _client.GetAsync($"/api/project-versions?projectId={projectId}")).ReadAsync<ListDto<VersionDto>>();
        Assert.Empty(list.Items);
    }

    [Fact]
    public async Task A_duplicate_version_name_in_a_project_is_refused_and_names_the_field()
    {
        var (projectId, _) = await NewProjectWithSuiteAsync();
        await NewVersionAsync(projectId, "2.0");
        var response = await _client.PostAsJsonAsync("/api/project-versions", new { projectId, name = "2.0" });
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var error = await response.ReadErrorAsync();
        Assert.Equal("duplicate-version", error.Error.Code);
        Assert.True(error.Error.Fields!.ContainsKey("name"));
    }

    [Fact]
    public async Task Only_one_version_of_a_project_is_current()
    {
        var (projectId, _) = await NewProjectWithSuiteAsync();
        var first = await NewVersionAsync(projectId, "1.0", isCurrent: true);
        var second = await NewVersionAsync(projectId, "2.0", isCurrent: true);
        var list = await (await _client.GetAsync($"/api/project-versions?projectId={projectId}")).ReadAsync<ListDto<VersionDto>>();
        Assert.False(list.Items.Single(v => v.Id == first.Id).IsCurrent);
        Assert.True(list.Items.Single(v => v.Id == second.Id).IsCurrent);
    }

    [Fact]
    public async Task Cases_can_be_given_a_version_filtered_by_it_and_keep_living_when_it_is_deleted()
    {
        var (projectId, suiteId) = await NewProjectWithSuiteAsync();
        var version = await NewVersionAsync(projectId, "3.0");
        var testCase = await NewCaseAsync(suiteId);

        var assign = await _client.PostAsJsonAsync("/api/test-cases/assign-version", new { ids = new[] { testCase.Id, "TC_MISSING_X" }, projectVersionId = version.Id });
        Assert.Equal(HttpStatusCode.OK, assign.StatusCode);
        var outcome = await assign.ReadAsync<AssignDto>();
        Assert.Equal(1, outcome.Assigned);
        Assert.Equal(1, outcome.NotFound);

        var page = await (await _client.GetAsync($"/api/test-cases?projectVersionId={version.Id}")).ReadAsync<VersionedPageDto>();
        var row = Assert.Single(page.Items);
        Assert.Equal(version.Id, row.ProjectVersionId);
        Assert.Equal("3.0", row.ProjectVersionName);

        var versions = await (await _client.GetAsync($"/api/project-versions?projectId={projectId}")).ReadAsync<ListDto<VersionDto>>();
        Assert.Equal(1, versions.Items.Single().TestCaseCount);

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/project-versions/{version.Id}")).StatusCode);
        var read = await (await _client.GetAsync($"/api/test-cases/{testCase.Id}")).ReadAsync<VersionedCaseDto>();
        Assert.Null(read.ProjectVersionId);
    }

    [Fact]
    public async Task A_case_cannot_be_given_another_projects_version()
    {
        var (_, suiteId) = await NewProjectWithSuiteAsync();
        var (otherProjectId, _) = await NewProjectWithSuiteAsync();
        var foreign = await NewVersionAsync(otherProjectId, "9.9");
        var testCase = await NewCaseAsync(suiteId);
        var response = await _client.PostAsJsonAsync("/api/test-cases/assign-version", new { ids = new[] { testCase.Id }, projectVersionId = foreign.Id });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("version-project-mismatch", (await response.ReadErrorAsync()).Error.Code);
    }

    [Fact]
    public async Task A_case_made_by_hand_is_created_with_its_version_in_one_request()
    {
        var (projectId, suiteId) = await NewProjectWithSuiteAsync();
        var version = await NewVersionAsync(projectId, "5.0");
        var response = await _client.PostAsJsonAsync("/api/test-cases", new { testSuiteId = suiteId, title = "By hand", projectVersionId = version.Id });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(version.Id, (await response.ReadAsync<VersionedCaseDto>()).ProjectVersionId);

        var (otherProjectId, _) = await NewProjectWithSuiteAsync();
        var foreign = await NewVersionAsync(otherProjectId, "5.0");
        var refused = await _client.PostAsJsonAsync("/api/test-cases", new { testSuiteId = suiteId, title = "Wrong", projectVersionId = foreign.Id });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Equal("version-project-mismatch", (await refused.ReadErrorAsync()).Error.Code);
    }

    [Fact]
    public async Task An_imported_case_for_a_chosen_project_is_filed_by_module_inside_that_project_with_its_version()
    {
        var (projectId, _) = await NewProjectWithSuiteAsync();
        var version = await NewVersionAsync(projectId, "6.0");
        var id = Unique("IMP");
        var module = Unique("Checkout ");
        var payload = new
        {
            schemaVersion = 1,
            id,
            title = "Imported",
            module,
            steps = Array.Empty<object>(),
            source = new { workbook = "plan.xlsx", worksheet = "Cases", rowNumber = 3 },
            projectId,
            projectVersionId = version.Id,
        };
        var batch = await api.Worker.PostAsJsonAsync("/internal/persistence/batch", new { operations = new[] { new { kind = "test-case.upsert", key = id, payload } } });
        Assert.Equal(HttpStatusCode.OK, batch.StatusCode);
        var read = await (await _client.GetAsync($"/api/test-cases/{id}")).ReadAsync<FiledCaseDto>();
        Assert.Equal(projectId, read.ProjectId);
        Assert.Equal(module, read.TestSuiteName);
        Assert.Equal(version.Id, read.ProjectVersionId);
    }

    [Fact]
    public async Task Insights_count_the_library_by_project_and_version()
    {
        var (projectId, suiteId) = await NewProjectWithSuiteAsync();
        var version = await NewVersionAsync(projectId, "4.0");
        var testCase = await NewCaseAsync(suiteId);
        await _client.PostAsJsonAsync("/api/test-cases/assign-version", new { ids = new[] { testCase.Id }, projectVersionId = version.Id });

        var insights = await (await _client.GetAsync("/api/insights?days=7")).ReadAsync<InsightsDto>();
        Assert.True(insights.TotalCases >= 1);
        Assert.True(insights.TotalVersions >= 1);
        Assert.Contains(insights.ByProject, p => p.Key == projectId.ToString(System.Globalization.CultureInfo.InvariantCulture) && p.Count == 1);
        Assert.Contains(insights.ByVersion, v => v.Key == version.Id.ToString(System.Globalization.CultureInfo.InvariantCulture) && v.Count == 1);
        Assert.NotEmpty(insights.AddedPerDay);

        // Scoped to the project (and version) the person works in: only its own cases count.
        var scoped = await (await _client.GetAsync($"/api/insights?days=7&projectId={projectId}&versionId={version.Id}")).ReadAsync<InsightsDto>();
        Assert.Equal(1, scoped.TotalCases);
        Assert.Equal(1, scoped.TotalVersions);
        Assert.Single(scoped.ByProject);
    }

    private sealed record VersionDto(int Id, int ProjectId, string Name, string? ReleaseDate, bool IsCurrent, bool IsActive, int TestCaseCount, string RowVersion);

    private sealed record AssignDto(int Assigned, int NotFound);

    private sealed record FiledCaseDto(string Id, int ProjectId, string TestSuiteName, int? ProjectVersionId);

    private sealed record VersionedCaseDto(string Id, int? ProjectVersionId, string? ProjectVersionName);

    private sealed record VersionedPageDto(int Total, List<VersionedCaseDto> Items);

    private sealed record CountDto(string Key, string Label, int Count);

    private sealed record DayDto(string Day, int Count);

    private sealed record InsightsDto(int TotalCases, int TotalVersions, List<CountDto> ByProject, List<CountDto> ByVersion, List<DayDto> AddedPerDay);
}
