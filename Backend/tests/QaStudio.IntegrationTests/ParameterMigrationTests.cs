using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using QaStudio.Infrastructure.Persistence;
using QaStudio.Infrastructure.Persistence.Migrations;

namespace QaStudio.IntegrationTests;

/// <summary>
/// The data copy of the migration that moved parameter values from two config blocks into tables. It runs the migration's own
/// SQL against a seeded database: what is copied, what is skipped, that running it twice changes nothing, and that backing out
/// rebuilds the blocks so nothing saved after the upgrade is lost.
/// </summary>
[Collection(nameof(ApiTestGroup))]
public class ParameterMigrationTests(ApiFixture api)
{
    private readonly HttpClient _client = api.CreateClient();

    private static string Unique(string prefix) => $"{prefix}{Guid.NewGuid():N}"[..20].ToUpperInvariant();

    private async Task SetBlockAsync(string key, object value) =>
        Assert.True((await api.Worker.PostAsJsonAsync("/internal/persistence/batch", new { operations = new object[] { new { kind = "config.upsert", key, payload = value } } })).IsSuccessStatusCode);

    private async Task<T> InDatabaseAsync<T>(Func<QaStudioDbContext, Task<T>> work)
    {
        await using var scope = api.Services.CreateAsyncScope();
        return await work(scope.ServiceProvider.GetRequiredService<QaStudioDbContext>());
    }

    // The migration's SQL holds JSON braces, which ExecuteSqlRaw would read as format placeholders, so it is run as plain text.
    private static async Task RunAsync(QaStudioDbContext db, string sql)
    {
        var connection = db.Database.GetDbConnection();
        await db.Database.OpenConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    [Fact]
    public async Task Values_are_copied_skipping_what_the_app_could_never_have_saved_and_a_second_run_adds_nothing()
    {
        var project = await (await _client.PostAsJsonAsync("/api/projects", new { code = Unique("M"), name = "Migrated" })).ReadAsync<ProjectDto>();
        var suite = await (await _client.PostAsJsonAsync("/api/test-suites", new { projectId = project.Id, name = Unique("S") })).ReadAsync<SuiteDto>();
        var caseId = Unique("TC_");
        await _client.PostAsJsonAsync("/api/test-cases", new { id = caseId, testSuiteId = suite.Id, title = "Migrated case", steps = new[] { "Open" } });
        var gone = Unique("GONE");
        var tooLong = new string('x', 501);

        await SetBlockAsync("case-parameters", new Dictionary<string, object>
        {
            [caseId] = new Dictionary<string, string> { ["projectCode"] = "  PRJ-1  ", ["Role-name_2"] = "Admin", ["empty"] = "   ", ["1bad"] = "x", ["has space"] = "x", ["long"] = tooLong },
            [gone] = new Dictionary<string, string> { ["a"] = "b" },
        });
        await SetBlockAsync("project-parameters", new Dictionary<string, object>
        {
            [project.Id.ToString(System.Globalization.CultureInfo.InvariantCulture)] = new Dictionary<string, string> { ["projectCode"] = "COMMON", ["blank"] = "" },
            ["987654"] = new Dictionary<string, string> { ["a"] = "b" },
            ["not-a-number"] = new Dictionary<string, string> { ["a"] = "b" },
        });

        var copied = await InDatabaseAsync(async db =>
        {
            await db.Database.ExecuteSqlRawAsync("DELETE FROM dbo.CaseParameterValues; DELETE FROM dbo.ProjectParameterValues;");
            await RunAsync(db, MoveParametersToTables.CopyCaseValues);
            await RunAsync(db, MoveParametersToTables.CopyProjectValues);
            // A second run finds every row already there.
            await RunAsync(db, MoveParametersToTables.CopyCaseValues);
            await RunAsync(db, MoveParametersToTables.CopyProjectValues);
            return (
                await db.CaseParameterValues.AsNoTracking().OrderBy(v => v.Name).Select(v => $"{v.CaseCode}|{v.Name}|{v.Value}").ToListAsync(),
                await db.ProjectParameterValues.AsNoTracking().OrderBy(v => v.Name).Select(v => $"{v.ProjectId}|{v.Name}|{v.Value}").ToListAsync());
        });

        // Trimmed, valid names only, an existing case only; empty, oversized, badly named and orphaned values are left out.
        Assert.Equal([$"{caseId}|Role-name_2|Admin", $"{caseId}|projectCode|PRJ-1"], copied.Item1);
        Assert.Equal([$"{project.Id}|projectCode|COMMON"], copied.Item2);
    }

    [Fact]
    public async Task Backing_out_rebuilds_both_blocks_from_the_tables_including_values_saved_after_the_upgrade()
    {
        var project = await (await _client.PostAsJsonAsync("/api/projects", new { code = Unique("B"), name = "Backed out" })).ReadAsync<ProjectDto>();
        var caseId = Unique("TC_");
        var now = DateTime.UtcNow;

        await InDatabaseAsync(async db =>
        {
            await db.Database.ExecuteSqlRawAsync("DELETE FROM dbo.CaseParameterValues; DELETE FROM dbo.ProjectParameterValues;");
            await db.Database.ExecuteSqlRawAsync(
                "INSERT INTO dbo.CaseParameterValues (CaseCode, Name, Value, UpdatedAtUtc) VALUES ({0}, N'role', N'Admin \"quoted\"', {2}), ({0}, N'code', N'A\\B', {2});" +
                "INSERT INTO dbo.ProjectParameterValues (ProjectId, Name, Value, UpdatedAtUtc) VALUES ({1}, N'projectCode', N'PRJ', {2});",
                caseId, project.Id, now);
            await RunAsync(db, MoveParametersToTables.RebuildBlocks);
            return 0;
        });

        var snapshot = await (await api.Worker.GetAsync("/internal/persistence/snapshot")).ReadAsync<JsonElement>();
        var cases = snapshot.GetProperty("config").GetProperty("case-parameters");
        Assert.Equal("Admin \"quoted\"", cases.GetProperty(caseId).GetProperty("role").GetString());
        Assert.Equal("A\\B", cases.GetProperty(caseId).GetProperty("code").GetString());
        var projects = snapshot.GetProperty("config").GetProperty("project-parameters");
        Assert.Equal("PRJ", projects.GetProperty(project.Id.ToString(System.Globalization.CultureInfo.InvariantCulture)).GetProperty("projectCode").GetString());
    }
}
