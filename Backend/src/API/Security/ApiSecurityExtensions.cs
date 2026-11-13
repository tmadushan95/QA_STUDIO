namespace QaStudio.Api.Security;

/// <summary>Wires up API security.</summary>
public static class ApiSecurityExtensions
{
    /// <summary>Adds the options and session store.</summary>
    /// <param name="services">The service collection.</param>
    /// <param name="configuration">Application configuration.</param>
    /// <returns>The same collection.</returns>
    public static IServiceCollection AddApiSecurity(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        services.Configure<SecurityOptions>(configuration.GetSection(SecurityOptions.Section));
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<SessionStore>();
        return services;
    }

    /// <summary>Adds the checks to the pipeline.</summary>
    /// <param name="app">The application.</param>
    /// <returns>The same application.</returns>
    public static WebApplication UseApiSecurity(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
        app.UseMiddleware<ApiSecurityMiddleware>();
        return app;
    }
}
