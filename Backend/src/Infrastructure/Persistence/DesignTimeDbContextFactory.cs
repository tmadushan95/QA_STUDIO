using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>
/// Lets <c>dotnet ef</c> build the context without starting the API. It reads the same <c>Backend/appsettings.json</c>
/// and environment overrides, so the connection string is still in one place only.
/// </summary>
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<QaStudioDbContext>
{
    /// <inheritdoc />
    public QaStudioDbContext CreateDbContext(string[] args)
    {
        var configuration = new ConfigurationBuilder()
            .SetBasePath(FindBackendRoot())
            .AddJsonFile("appsettings.json", optional: false)
            .AddJsonFile("appsettings.Development.json", optional: true)
            .AddEnvironmentVariables()
            .Build();
        var connectionString = configuration.GetConnectionString(DependencyInjection.ConnectionName)
            ?? throw new InvalidOperationException($"Connection string \"{DependencyInjection.ConnectionName}\" is not configured.");
        var options = new DbContextOptionsBuilder<QaStudioDbContext>().UseSqlServer(connectionString).Options;
        return new QaStudioDbContext(options);
    }

    private static string FindBackendRoot()
    {
        for (var dir = new DirectoryInfo(Directory.GetCurrentDirectory()); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "appsettings.json")) && File.Exists(Path.Combine(dir.FullName, "QaStudio.sln")))
            {
                return dir.FullName;
            }
        }

        throw new InvalidOperationException("Run this from inside the Backend folder.");
    }
}

