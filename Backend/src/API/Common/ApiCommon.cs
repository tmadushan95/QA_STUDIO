using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using QaStudio.Infrastructure;
using QaStudio.Infrastructure.Persistence;

namespace QaStudio.Api.Common;

/// <summary>Wires up what every endpoint relies on.</summary>
public static class ApiCommonExtensions
{
    /// <summary>Adds JSON settings and the error handler.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection.</returns>
    public static IServiceCollection AddApiCommon(this IServiceCollection services)
    {
        services.Configure<JsonOptions>(options =>
        {
            // The worker's schemas treat a field as optional-if-absent, not nullable, so null must never be written.
            options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
        });
        // Malformed bodies and route values become exceptions, so they get the same error shape as everything else.
        services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = true);
        services.AddExceptionHandler<ApiExceptionHandler>();
        services.AddProblemDetails();
        return services;
    }

    /// <summary>Finds and maps every <see cref="IEndpoint"/> in this assembly.</summary>
    /// <param name="routes">The route builder.</param>
    /// <returns>The same builder.</returns>
    public static IEndpointRouteBuilder MapApiEndpoints(this IEndpointRouteBuilder routes)
    {
        var endpoints = typeof(ApiCommonExtensions).Assembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false } && type.IsAssignableTo(typeof(IEndpoint)));
        foreach (var type in endpoints)
        {
            ((IEndpoint)Activator.CreateInstance(type)!).Map(routes);
        }

        return routes;
    }

    /// <summary>Applies pending migrations when <c>Database:ApplyMigrationsOnStartup</c> is on.</summary>
    /// <param name="app">The application.</param>
    /// <returns>A task that completes when done.</returns>
    public static async Task MigrateDatabaseIfConfiguredAsync(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
        if (!app.Services.GetRequiredService<IOptions<DatabaseOptions>>().Value.ApplyMigrationsOnStartup)
        {
            return;
        }

        var scope = app.Services.CreateAsyncScope();
        await using (scope.ConfigureAwait(false))
        {
            await scope.ServiceProvider.GetRequiredService<QaStudioDbContext>().Database.MigrateAsync().ConfigureAwait(false);
        }
    }

    /// <summary>Serves the built frontend when <c>Frontend:DistPath</c> points at one.</summary>
    /// <param name="app">The application.</param>
    /// <returns>The same application.</returns>
    public static WebApplication UseFrontend(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
        if (FrontendDist(app) is { } dist)
        {
            app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = new PhysicalFileProvider(dist) });
            app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(dist) });
        }

        return app;
    }

    /// <summary>Sends unmatched non-API paths to the frontend's index page.</summary>
    /// <param name="app">The application.</param>
    /// <returns>The same application.</returns>
    public static WebApplication MapFrontendFallback(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
        if (FrontendDist(app) is { } dist)
        {
            app.MapFallbackToFile("index.html", new StaticFileOptions { FileProvider = new PhysicalFileProvider(dist) });
        }

        return app;
    }

    private static string? FrontendDist(WebApplication app)
    {
        var configured = app.Configuration["Frontend:DistPath"];
        if (string.IsNullOrWhiteSpace(configured))
        {
            return null;
        }

        var full = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, configured));
        return File.Exists(Path.Combine(full, "index.html")) ? full : null;
    }
}
