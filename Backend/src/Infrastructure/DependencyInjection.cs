using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using QaStudio.Application.Abstractions;
using QaStudio.Infrastructure.Persistence;
using QaStudio.Infrastructure.Persistence.Dapper;
using QaStudio.Infrastructure.Persistence.Repositories;
using QaStudio.Infrastructure.Worker;

namespace QaStudio.Infrastructure;

/// <summary>Registers the infrastructure layer.</summary>
public static class DependencyInjection
{
    /// <summary>The name of the connection string in configuration.</summary>
    public const string ConnectionName = "QaStudio";

    /// <summary>Adds SQL Server persistence, the master data cache and the worker client.</summary>
    /// <param name="services">The service collection.</param>
    /// <param name="configuration">Application configuration.</param>
    /// <returns>The same collection.</returns>
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddOptions<DatabaseOptions>().Bind(configuration.GetSection(DatabaseOptions.Section)).ValidateDataAnnotations().ValidateOnStart();
        services.AddOptions<WorkerOptions>().Bind(configuration.GetSection(WorkerOptions.Section));

        // Read when the first context is built, not here: configuration is only final once the host is built, and a
        // value captured now would ignore later overrides. That once pointed integration tests at the real database.
        // Pooling reuses DbContext instances; SqlClient pools the connections underneath. Sizes are in the connection string.
        services.AddDbContextPool<QaStudioDbContext>((provider, options) =>
        {
            var finalConfiguration = provider.GetRequiredService<IConfiguration>();
            var database = provider.GetRequiredService<IOptions<DatabaseOptions>>().Value;
            var connectionString = finalConfiguration.GetConnectionString(ConnectionName)
                ?? throw new InvalidOperationException($"Connection string \"{ConnectionName}\" is not configured.");
            options.UseSqlServer(
                connectionString,
                sql =>
                {
                    sql.CommandTimeout(database.CommandTimeoutSeconds);
                    if (database.MaxRetryCount > 0)
                    {
                        sql.EnableRetryOnFailure(database.MaxRetryCount);
                    }
                });
        });

        services.AddSingleton<IClock, SystemClock>();
        services.AddScoped<IUnitOfWork, UnitOfWork>();
        services.AddScoped<IProjectRepository, ProjectRepository>();
        services.AddScoped<ITestSuiteRepository, TestSuiteRepository>();
        services.AddScoped<IProjectVersionRepository, ProjectVersionRepository>();
        services.AddScoped<ITestCaseRepository, TestCaseRepository>();
        services.AddScoped<ITestCaseReader, TestCaseReader>();
        services.AddScoped<IAuditRepository, AuditRepository>();
        services.AddScoped<IWorkerStateStore, WorkerStateStore>();

        // Read side with Dapper (flat projections and aggregates); EF Core keeps the write side and the schema.
        services.AddSingleton<ISqlConnectionFactory, SqlConnectionFactory>();
        services.AddScoped<IInsightsReader, InsightsReader>();
        services.AddScoped<IDashboardReader, DashboardReader>();
        services.AddScoped<IRunReader, RunReader>();
        services.AddScoped<IConfigStore, ConfigStore>();
        services.AddScoped<IParameterCaseReader, ParameterCaseReader>();
        services.AddScoped<IParameterStore, ParameterStore>();

        services.AddMemoryCache();
        services.AddSingleton<MasterDataCache>();
        services.AddSingleton<IMasterDataCacheInvalidator>(sp => sp.GetRequiredService<MasterDataCache>());
        services.AddScoped<MasterDataReader>();
        // Decorator: callers see IMasterDataReader and never know whether a read came from memory.
        services.AddScoped<IMasterDataReader>(sp => new CachedMasterDataReader(
            sp.GetRequiredService<MasterDataReader>(),
            sp.GetRequiredService<MasterDataCache>()));

        services.AddHttpClient<IWorkerNotifier, WorkerNotifier>((sp, client) =>
        {
            client.BaseAddress = sp.GetRequiredService<IOptions<WorkerOptions>>().Value.BaseUrl;
            client.Timeout = TimeSpan.FromSeconds(5);
        })
        // The worker is local, so a refused connection should cost a save almost nothing when it is stopped.
        .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { ConnectTimeout = TimeSpan.FromMilliseconds(500) });

        // Asking the AI for values can take a while (the worker allows the model 30 seconds); a stopped worker still costs little.
        services.AddHttpClient<IParameterAi, WorkerParameterAi>((sp, client) =>
        {
            client.BaseAddress = sp.GetRequiredService<IOptions<WorkerOptions>>().Value.BaseUrl;
            client.Timeout = TimeSpan.FromSeconds(45);
        })
        .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { ConnectTimeout = TimeSpan.FromMilliseconds(500) });
        return services;
    }
}

/// <summary>The real clock.</summary>
internal sealed class SystemClock : IClock
{
    public DateTime UtcNow => DateTime.UtcNow;
}

