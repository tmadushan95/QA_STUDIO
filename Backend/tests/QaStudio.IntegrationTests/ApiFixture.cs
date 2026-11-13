using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using QaStudio.Infrastructure.Persistence;

namespace QaStudio.IntegrationTests;

/// <summary>
/// Hosts the real API against a throw-away database on the configured server, created for the test run and dropped after.
/// QASTUDIO_TEST_CONNECTION overrides the server; otherwise it comes from Backend/appsettings.json.
/// </summary>
public sealed class ApiFixture : WebApplicationFactory<Program>, IAsyncLifetime
{
    public const string InternalToken = "integration-test-internal-token";

    private readonly string _databaseName = $"QaStudio_Test_{Guid.NewGuid():N}";
    private string _connectionString = string.Empty;

    public HttpClient Worker { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        var configured = Environment.GetEnvironmentVariable("QASTUDIO_TEST_CONNECTION")
            ?? new ConfigurationBuilder()
                .AddJsonFile(Path.Combine(AppContext.BaseDirectory, "appsettings.json"))
                .Build()
                .GetConnectionString("QaStudio")!;
        _connectionString = new SqlConnectionStringBuilder(configured) { InitialCatalog = _databaseName }.ConnectionString;

        var scope = Services.CreateAsyncScope();
        await using (scope)
        {
            var database = scope.ServiceProvider.GetRequiredService<QaStudioDbContext>().Database;
            // These tests delete and overwrite freely, so they must never start on anything but their own database.
            var actual = new SqlConnectionStringBuilder(database.GetConnectionString()).InitialCatalog;
            if (actual != _databaseName)
            {
                throw new InvalidOperationException($"Refusing to run: the API is connected to \"{actual}\", not the test database.");
            }

            await database.MigrateAsync();
        }

        Worker = CreateClient();
        Worker.DefaultRequestHeaders.Add("x-qa-internal-token", InternalToken);
    }

    public new async Task DisposeAsync()
    {
        Worker.Dispose();
        await base.DisposeAsync();
        SqlConnection.ClearAllPools();
        var master = new SqlConnectionStringBuilder(_connectionString) { InitialCatalog = "master" }.ConnectionString;
        await using var connection = new SqlConnection(master);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandTimeout = 120;
        command.CommandText = $"IF DB_ID(N'{_databaseName}') IS NOT NULL BEGIN ALTER DATABASE [{_databaseName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{_databaseName}]; END";
        await command.ExecuteNonQueryAsync();
    }

    /// <summary>Opens a second API instance on the same database with extra settings.</summary>
    public WebApplicationFactory<Program> WithSettings(params (string Key, string Value)[] settings) =>
        WithWebHostBuilder(builder => builder.ConfigureAppConfiguration(config =>
            config.AddInMemoryCollection(settings.Select(s => new KeyValuePair<string, string?>(s.Key, s.Value)))));

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration(config => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:QaStudio"] = _connectionString,
            ["Worker:InternalToken"] = InternalToken,
            // Nothing listens here, which is also how "the worker is down" gets tested.
            ["Worker:BaseUrl"] = "http://127.0.0.1:1",
            ["Frontend:DistPath"] = string.Empty,
        }));
    }
}

[CollectionDefinition(nameof(ApiTestGroup))]
public sealed class ApiTestGroup : ICollectionFixture<ApiFixture>;

/// <summary>Small helpers shared by the test classes.</summary>
public static class Http
{
    public static async Task<T> ReadAsync<T>(this HttpResponseMessage response)
    {
        var body = await response.Content.ReadFromJsonAsync<T>();
        Assert.NotNull(body);
        return body;
    }

    public static async Task<ErrorEnvelope> ReadErrorAsync(this HttpResponseMessage response) =>
        await response.ReadAsync<ErrorEnvelope>();
}

public sealed record ErrorEnvelope(ErrorDetail Error);

public sealed record ErrorDetail(string Code, string Message, Dictionary<string, string>? Fields);


public sealed record ProjectDto(int Id, string Code, string Name, bool IsActive, int SuiteCount, int TestCaseCount, string RowVersion);

public sealed record SuiteDto(int Id, int ProjectId, string ProjectName, string Name, int TestCaseCount, string RowVersion);

public sealed record StepDto(int Order, string Action, string? Expected);

public sealed record CaseDto(string Id, string Title, string? Module, List<StepDto> Steps, int TestSuiteId, string TestSuiteName, int ProjectId, string ProjectName, string RowVersion);

public sealed record CasePageDto(int Total, int Page, int PageSize, List<CaseDto> Items);

public sealed record ListDto<T>(List<T> Items);

