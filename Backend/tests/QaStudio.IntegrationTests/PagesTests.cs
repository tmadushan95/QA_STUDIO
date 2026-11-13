using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace QaStudio.IntegrationTests;

/// <summary>The page list is edited through this API and kept in the database, where the worker reads it.</summary>
[Collection(nameof(ApiTestGroup))]
public class PagesTests(ApiFixture api)
{
    private readonly HttpClient _client = api.CreateClient();

    private static string Unique(string prefix) => $"{prefix}{Guid.NewGuid():N}"[..20].ToUpperInvariant();

    private async Task<int> NewProjectAsync() =>
        (await (await _client.PostAsJsonAsync("/api/projects", new { code = Unique("G"), name = "Paged" })).ReadAsync<ProjectDto>()).Id;

    private async Task<JsonElement> SnapshotAsync() =>
        await (await api.Worker.GetAsync("/internal/persistence/snapshot")).ReadAsync<JsonElement>();

    [Fact]
    public async Task A_projects_own_list_is_saved_trimmed_and_read_back_apart_from_the_shared_list()
    {
        var projectId = await NewProjectAsync();
        var put = await _client.PutAsJsonAsync("/api/pages", new { projectId, pages = new[] { new { name = " Dashboard ", route = "/home", marker = " Hi " } } });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var saved = await put.ReadAsync<JsonElement>();
        Assert.Equal("Dashboard", saved.GetProperty("items")[0].GetProperty("name").GetString());
        Assert.Equal("Hi", saved.GetProperty("items")[0].GetProperty("marker").GetString());

        var mine = await (await _client.GetAsync($"/api/pages?projectId={projectId}")).ReadAsync<JsonElement>();
        Assert.Equal("/home", mine.GetProperty("items")[0].GetProperty("route").GetString());
        // The shared list and other projects are untouched.
        var other = await NewProjectAsync();
        Assert.Equal(0, (await (await _client.GetAsync($"/api/pages?projectId={other}")).ReadAsync<JsonElement>()).GetProperty("items").GetArrayLength());

        // The worker reads the same rows: the block is in the snapshot it loads at start-up.
        var block = (await SnapshotAsync()).GetProperty("config").GetProperty($"pages:{projectId}");
        Assert.Equal("/home", block[0].GetProperty("route").GetString());
    }

    [Fact]
    public async Task The_shared_list_is_replaced_as_a_whole()
    {
        var put = await _client.PutAsJsonAsync("/api/pages", new { pages = new[] { new { name = Unique("Pg"), route = "/a" }, new { name = Unique("Pg"), route = "/b" } } });
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        Assert.Equal(2, (await put.ReadAsync<JsonElement>()).GetProperty("items").GetArrayLength());
        Assert.Equal(2, (await (await _client.GetAsync("/api/pages")).ReadAsync<JsonElement>()).GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task A_duplicate_name_is_refused_and_named_beside_its_field()
    {
        var response = await _client.PutAsJsonAsync("/api/pages", new { pages = new[] { new { name = "A", route = "/a" }, new { name = "a", route = "/b" } } });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var error = (await response.ReadErrorAsync()).Error;
        Assert.Equal("invalid-pages", error.Code);
        Assert.Contains("pages.1.name", error.Fields!.Keys);
    }

    [Fact]
    public async Task A_list_for_a_project_that_does_not_exist_is_a_404()
    {
        var response = await _client.PutAsJsonAsync("/api/pages", new { projectId = 987654, pages = new[] { new { name = "A", route = "/a" } } });
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Saving_the_list_is_written_to_the_audit_trail()
    {
        var projectId = await NewProjectAsync();
        await _client.PutAsJsonAsync("/api/pages", new { projectId, pages = new[] { new { name = "A", route = "/a" } } });
        var audit = await (await _client.GetAsync("/api/audit?limit=50")).ReadAsync<JsonElement>();
        Assert.Contains(audit.GetProperty("items").EnumerateArray(), a =>
            a.GetProperty("action").GetString() == "pages.update" && a.GetProperty("target").GetString() == $"project {projectId}");
    }

    [Fact]
    public async Task The_worker_can_fetch_the_blocks_again_with_the_internal_secret_only()
    {
        var projectId = await NewProjectAsync();
        await _client.PutAsJsonAsync("/api/pages", new { projectId, pages = new[] { new { name = "A", route = "/a" } } });

        using var anonymous = api.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/internal/persistence/config?prefix=pages")).StatusCode);

        var blocks = await (await api.Worker.GetAsync("/internal/persistence/config?prefix=pages")).ReadAsync<JsonElement>();
        Assert.Contains(blocks.GetProperty("items").EnumerateArray(), b => b.GetProperty("key").GetString() == $"pages:{projectId}");
    }
}
