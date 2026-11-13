using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace QaStudio.IntegrationTests;

[Collection(nameof(ApiTestGroup))]
public class WorkerStateTests(ApiFixture api)
{
    private const string Batch = "/internal/persistence/batch";

    private static string Unique(string prefix = "W") => $"{prefix}{Guid.NewGuid():N}"[..20];

    private static object Case(string id, string? module = null) => new
    {
        schemaVersion = 1,
        id,
        title = $"Title {id}",
        module,
        steps = new[] { new { order = 1, action = "Do it", expected = "It works" } },
        tags = new[] { "smoke" },
        dependsOn = Array.Empty<string>(),
        readiness = "ready",
        source = new { workbook = "plan.xlsx", worksheet = "Cases", rowNumber = 7 },
    };

    private static object Scenario(string caseId, int version, string status = "approved") =>
        new { caseId, version, status, scenario = new { schemaVersion = 1, caseId, steps = Array.Empty<object>() } };

    private Task<HttpResponseMessage> SendAsync(params object[] operations) =>
        api.Worker.PostAsJsonAsync(Batch, new { operations });

    private async Task<JsonElement> SnapshotAsync() =>
        await (await api.Worker.GetAsync("/internal/persistence/snapshot")).ReadAsync<JsonElement>();

    [Fact]
    public async Task Internal_routes_refuse_a_missing_or_wrong_secret()
    {
        using var anonymous = api.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/internal/persistence/snapshot")).StatusCode);
        anonymous.DefaultRequestHeaders.Add("x-qa-internal-token", "wrong");
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync(Batch, new { operations = Array.Empty<object>() })).StatusCode);
    }

    [Fact]
    public async Task Internal_routes_stay_closed_when_no_secret_is_configured()
    {
        using var factory = api.WithSettings(("Worker:InternalToken", string.Empty));
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("x-qa-internal-token", string.Empty);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/internal/persistence/snapshot")).StatusCode);
    }

    [Fact]
    public async Task An_imported_case_is_filed_by_its_module_in_the_default_project()
    {
        var module = Unique("Module ");
        var id = Unique();
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(new { kind = "test-case.upsert", key = id, payload = Case(id, module) })).StatusCode);
        var read = await (await api.Worker.GetAsync($"/api/test-cases/{id}")).ReadAsync<CaseDto>();
        Assert.Equal(module, read.TestSuiteName);
        Assert.Equal("General", read.ProjectName);
        Assert.Equal("It works", Assert.Single(read.Steps).Expected);
    }

    [Fact]
    public async Task A_new_case_honours_its_suite_and_version_hints_but_an_existing_case_keeps_its_filing()
    {
        var project = await (await api.Worker.PostAsJsonAsync("/api/projects", new { code = Unique("HP").ToUpperInvariant(), name = "Hinted" })).ReadAsync<ProjectDto>();
        var suite = await (await api.Worker.PostAsJsonAsync("/api/test-suites", new { projectId = project.Id, name = Unique("S") })).ReadAsync<SuiteDto>();
        var version = await (await api.Worker.PostAsJsonAsync("/api/project-versions", new { projectId = project.Id, name = "1.0" })).ReadAsync<IdDto>();
        var id = Unique();
        var hinted = new { schemaVersion = 1, id, title = "Hinted", steps = Array.Empty<object>(), source = new { workbook = "azure-devops", worksheet = "plan 1", rowNumber = 42 }, testSuiteId = suite.Id, projectVersionId = version.Id };
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(new { kind = "test-case.upsert", key = id, payload = hinted })).StatusCode);
        var read = await (await api.Worker.GetAsync($"/api/test-cases/{id}")).ReadAsync<HintedCaseDto>();
        Assert.Equal(suite.Id, read.TestSuiteId);
        Assert.Equal(version.Id, read.ProjectVersionId);

        // A rewrite with another hint must not move it: filing an existing case is a person's decision.
        var rewrite = new { schemaVersion = 1, id, title = "Hinted again", steps = Array.Empty<object>(), source = new { workbook = "azure-devops", worksheet = "plan 1", rowNumber = 42 }, testSuiteId = 1 };
        await SendAsync(new { kind = "test-case.upsert", key = id, payload = rewrite });
        read = await (await api.Worker.GetAsync($"/api/test-cases/{id}")).ReadAsync<HintedCaseDto>();
        Assert.Equal(suite.Id, read.TestSuiteId);
    }

    private sealed record IdDto(int Id);

    private sealed record HintedCaseDto(string Id, int TestSuiteId, int? ProjectVersionId);

    [Fact]
    public async Task Many_cases_in_one_module_share_one_new_suite()
    {
        var module = Unique("Shared ");
        var ids = new[] { Unique(), Unique(), Unique() };
        await SendAsync([.. ids.Select(id => (object)new { kind = "test-case.upsert", key = id, payload = Case(id, module) })]);
        var suites = await (await api.Worker.GetAsync("/api/test-suites")).ReadAsync<ListDto<SuiteDto>>();
        Assert.Equal(3, Assert.Single(suites.Items, s => s.Name == module).TestCaseCount);
    }

    [Fact]
    public async Task A_case_without_a_module_goes_to_unassigned()
    {
        var id = Unique();
        await SendAsync(new { kind = "test-case.upsert", key = id, payload = Case(id) });
        var read = await (await api.Worker.GetAsync($"/api/test-cases/{id}")).ReadAsync<CaseDto>();
        Assert.Equal("Unassigned", read.TestSuiteName);
    }

    [Fact]
    public async Task The_worker_rewriting_a_case_does_not_undo_where_someone_filed_it()
    {
        var id = Unique();
        await SendAsync(new { kind = "test-case.upsert", key = id, payload = Case(id, "Original") });
        var project = await (await api.Worker.PostAsJsonAsync("/api/projects", new { code = Unique("P").ToUpperInvariant(), name = "Mine" })).ReadAsync<ProjectDto>();
        var suite = await (await api.Worker.PostAsJsonAsync("/api/test-suites", new { projectId = project.Id, name = "Chosen" })).ReadAsync<SuiteDto>();
        await api.Worker.PostAsJsonAsync("/api/test-cases/move", new { ids = new[] { id }, testSuiteId = suite.Id });

        await SendAsync(new { kind = "test-case.upsert", key = id, payload = Case(id, "Original") });
        var read = await (await api.Worker.GetAsync($"/api/test-cases/{id}")).ReadAsync<CaseDto>();
        Assert.Equal(suite.Id, read.TestSuiteId);
    }

    [Fact]
    public async Task One_case_written_twice_in_a_batch_keeps_the_last_version()
    {
        var id = Unique();
        var changed = new { schemaVersion = 1, id, title = "Second", steps = Array.Empty<object>(), source = new { workbook = "w", worksheet = "s", rowNumber = 1 } };
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(
            new { kind = "test-case.upsert", key = id, payload = Case(id) },
            new { kind = "test-case.upsert", key = id, payload = changed })).StatusCode);
        var read = await (await api.Worker.GetAsync($"/api/test-cases/{id}")).ReadAsync<CaseDto>();
        Assert.Equal("Second", read.Title);
        Assert.Empty(read.Steps);
    }

    [Fact]
    public async Task A_batch_is_all_or_nothing()
    {
        var id = Unique();
        var response = await SendAsync(
            new { kind = "test-case.upsert", key = id, payload = Case(id) },
            new { kind = "no-such-operation" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("unknown-operation", (await response.ReadErrorAsync()).Error.Code);
        Assert.Equal(HttpStatusCode.NotFound, (await api.Worker.GetAsync($"/api/test-cases/{id}")).StatusCode);
    }

    [Fact]
    public async Task Scenarios_round_trip_exactly_including_a_delete_then_rewrite_in_one_batch()
    {
        var id = Unique();
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(
            new { kind = "scenario.upsert", key = id, slot = "draft", payload = Scenario(id, 1, "draft") },
            new { kind = "scenario.delete", key = id, slot = "draft" },
            new { kind = "scenario.upsert", key = id, slot = "draft", payload = Scenario(id, 2, "validated") },
            new { kind = "scenario.upsert", key = id, slot = "approved", payload = Scenario(id, 3) },
            new { kind = "revision.upsert", key = id, version = 1, payload = Scenario(id, 1) })).StatusCode);

        var snapshot = await SnapshotAsync();
        var drafts = snapshot.GetProperty("scenarios").EnumerateArray()
            .Where(s => s.GetProperty("caseId").GetString() == id && s.GetProperty("slot").GetString() == "draft").ToList();
        Assert.Equal(2, Assert.Single(drafts).GetProperty("record").GetProperty("version").GetInt32());
        Assert.Contains(snapshot.GetProperty("revisions").EnumerateArray(), r => r.GetProperty("caseId").GetString() == id);
    }

    [Fact]
    public async Task A_scenario_slot_must_be_a_known_one()
    {
        var response = await SendAsync(new { kind = "scenario.upsert", key = Unique(), slot = "other", payload = Scenario("x", 1) });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_project_with_test_accounts_cannot_be_deleted_until_they_are_gone()
    {
        var created = await (await api.Worker.PostAsJsonAsync("/api/projects", new { code = Unique("P").ToUpperInvariant(), name = "With accounts" })).ReadAsync<JsonElement>();
        var projectId = created.GetProperty("id").GetInt32();
        var account = Unique("A");
        Assert.Equal(
            HttpStatusCode.OK,
            (await SendAsync(new { kind = "account.upsert", key = account, payload = new { projectId, label = "Same label", username = "u", passwordEnc = "cipher", createdAt = "2026-01-01T00:00:00.000Z", updatedAt = "2026-01-01T00:00:00.000Z" } })).StatusCode);

        var refused = await api.Worker.DeleteAsync($"/api/projects/{projectId}");
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("project-has-accounts", (await refused.ReadErrorAsync()).Error.Code);

        Assert.Equal(HttpStatusCode.OK, (await SendAsync(new { kind = "account.delete", key = account })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await api.Worker.DeleteAsync($"/api/projects/{projectId}")).StatusCode);
    }

    [Fact]
    public async Task Everything_the_worker_keeps_comes_back_in_the_snapshot()
    {
        var account = Unique("A");
        var run = Unique("R");
        var backup = Unique("B");
        var provider = Unique("ai");
        var response = await SendAsync(
            new { kind = "account.upsert", key = account, payload = new { projectId = 1, label = Unique("L"), username = "u", passwordEnc = "cipher", createdAt = "2026-01-01T00:00:00.000Z", updatedAt = "2026-01-01T00:00:00.000Z" } },
            new { kind = "session.upsert", key = account, payload = new { stateEnc = "state", savedAt = "2026-01-01T00:00:00.000Z" } },
            new { kind = "ai-key.upsert", key = provider, payload = new { keyEnc = "k", updatedAt = "2026-01-01T00:00:00.000Z" } },
            new { kind = "run.upsert", key = run, payload = new { id = run, createdAt = "2030-01-01T00:00:00.000Z", status = "passed", cases = Array.Empty<object>() } },
            new { kind = "config.upsert", key = "app", payload = new { theme = "x" } },
            new { kind = "backup.upsert", key = backup, payload = new { id = backup, createdAt = "2026-01-01T00:00:00.000Z", reason = "Before", cases = Array.Empty<object>() } });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var s = await SnapshotAsync();
        Assert.Contains(s.GetProperty("accounts").EnumerateArray(), a => a.GetProperty("id").GetString() == account && a.GetProperty("passwordEnc").GetString() == "cipher");
        Assert.Contains(s.GetProperty("sessions").EnumerateArray(), a => a.GetProperty("accountId").GetString() == account);
        Assert.Contains(s.GetProperty("aiKeys").EnumerateArray(), a => a.GetProperty("provider").GetString() == provider);
        Assert.Contains(s.GetProperty("runs").EnumerateArray(), r => r.GetProperty("id").GetString() == run);
        Assert.Equal("x", s.GetProperty("config").GetProperty("app").GetProperty("theme").GetString());
        Assert.Contains(s.GetProperty("backups").EnumerateArray(), b => b.GetProperty("id").GetString() == backup);

        Assert.Equal(HttpStatusCode.OK, (await SendAsync(
            new { kind = "account.delete", key = account },
            new { kind = "ai-key.delete", key = provider },
            new { kind = "backup.delete", key = backup })).StatusCode);
        s = await SnapshotAsync();
        Assert.DoesNotContain(s.GetProperty("accounts").EnumerateArray(), a => a.GetProperty("id").GetString() == account);
        // A session goes with its account, by the foreign key.
        Assert.DoesNotContain(s.GetProperty("sessions").EnumerateArray(), a => a.GetProperty("accountId").GetString() == account);
    }

    [Fact]
    public async Task Undoing_a_clear_puts_cases_back_where_people_filed_them()
    {
        var id = Unique();
        var gone = Unique();
        await SendAsync(
            new { kind = "test-case.upsert", key = id, payload = Case(id, "Imported module") },
            new { kind = "test-case.upsert", key = gone, payload = Case(gone, "Imported module") });
        var project = await (await api.Worker.PostAsJsonAsync("/api/projects", new { code = Unique("P").ToUpperInvariant(), name = "Filing" })).ReadAsync<ProjectDto>();
        var suite = await (await api.Worker.PostAsJsonAsync("/api/test-suites", new { projectId = project.Id, name = "Filed" })).ReadAsync<SuiteDto>();
        var doomed = await (await api.Worker.PostAsJsonAsync("/api/test-suites", new { projectId = project.Id, name = "Doomed" })).ReadAsync<SuiteDto>();
        await api.Worker.PostAsJsonAsync("/api/test-cases/move", new { ids = new[] { id }, testSuiteId = suite.Id });
        await api.Worker.PostAsJsonAsync("/api/test-cases/move", new { ids = new[] { gone }, testSuiteId = doomed.Id });

        var backup = Unique("B");
        await SendAsync(new { kind = "backup.upsert", key = backup, payload = new { id = backup, createdAt = "2026-01-01T00:00:00.000Z", reason = "Before" } });
        await SendAsync(new { kind = "test-case.delete", key = id }, new { kind = "test-case.delete", key = gone });
        Assert.Equal(HttpStatusCode.NoContent, (await api.Worker.DeleteAsync($"/api/test-suites/{doomed.Id}")).StatusCode);

        await SendAsync(
            new { kind = "test-case.upsert", key = id, payload = Case(id, "Imported module") },
            new { kind = "test-case.upsert", key = gone, payload = Case(gone, "Imported module") },
            new { kind = "backup.restored", key = backup });

        Assert.Equal(suite.Id, (await (await api.Worker.GetAsync($"/api/test-cases/{id}")).ReadAsync<CaseDto>()).TestSuiteId);
        // Its suite was deleted in between, so it stays where the import rule put it rather than failing the undo.
        Assert.Equal("Imported module", (await (await api.Worker.GetAsync($"/api/test-cases/{gone}")).ReadAsync<CaseDto>()).TestSuiteName);
    }

    [Fact]
    public async Task Case_json_for_the_worker_leaves_out_nulls_because_its_schema_rejects_them()
    {
        var id = Unique();
        await SendAsync(new { kind = "test-case.upsert", key = id, payload = Case(id) });
        var cases = await (await api.Worker.GetAsync("/internal/persistence/test-cases")).ReadAsync<JsonElement>();
        var mine = cases.GetProperty("items").EnumerateArray().Single(c => c.GetProperty("id").GetString() == id);
        Assert.False(mine.TryGetProperty("description", out _));
        Assert.Equal(1, mine.GetProperty("schemaVersion").GetInt32());
        Assert.Equal("ready", mine.GetProperty("readiness").GetString());
        Assert.Equal("smoke", mine.GetProperty("tags")[0].GetString());
        Assert.Equal(7, mine.GetProperty("source").GetProperty("rowNumber").GetInt32());
    }
}

