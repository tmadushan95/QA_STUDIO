using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OpenTelemetry;
using OpenTelemetry.Metrics;
using OpenTelemetry.Trace;

namespace QaStudio.ServiceDefaults;

/// <summary>
/// Host setup every QA Studio .NET service shares. Today that is OpenTelemetry only: the AppHost injects
/// <c>OTEL_EXPORTER_OTLP_ENDPOINT</c>, and without it nothing is registered, so an install started by
/// <c>qa-studio.cmd</c> behaves exactly as before (no exporter, no background work, no extra allocations per request).
/// </summary>
/// <remarks>
/// Deliberately not added here (unlike the Aspire template): a global HTTP resilience handler, because retrying the
/// API's non-idempotent calls to the worker could start a run twice; and service discovery, because the AppHost passes
/// the worker's address as plain configuration (<c>Worker:BaseUrl</c>) that also works without Aspire.
/// </remarks>
public static class ServiceDefaultsExtensions
{
    /// <summary>The configuration key the OpenTelemetry SDK reads for the collector address.</summary>
    public const string OtlpEndpointKey = "OTEL_EXPORTER_OTLP_ENDPOINT";

    /// <summary>Requests that are polled or streamed and would only add noise to traces.</summary>
    private static readonly string[] UntracedPaths = ["/api/health", "/api/events"];

    /// <summary>Adds the shared host defaults. Safe to call in every environment.</summary>
    /// <param name="builder">The web application builder of the service.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static WebApplicationBuilder AddServiceDefaults(this WebApplicationBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        if (IsTelemetryEnabled(builder.Configuration))
        {
            builder.AddOpenTelemetry();
        }

        return builder;
    }

    /// <summary>True when an OTLP collector address is configured (the AppHost sets one; a plain install does not).</summary>
    /// <param name="configuration">The service configuration.</param>
    /// <returns>Whether telemetry should be exported.</returns>
    public static bool IsTelemetryEnabled(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        return !string.IsNullOrWhiteSpace(configuration[OtlpEndpointKey]);
    }

    private static void AddOpenTelemetry(this WebApplicationBuilder builder)
    {
        builder.Logging.AddOpenTelemetry(logging =>
        {
            logging.IncludeFormattedMessage = true;
            logging.IncludeScopes = true;
        });

        builder.Services.AddOpenTelemetry()
            .WithMetrics(metrics => metrics
                .AddAspNetCoreInstrumentation()
                .AddHttpClientInstrumentation()
                .AddRuntimeInstrumentation())
            .WithTracing(tracing => tracing
                .AddSource(builder.Environment.ApplicationName)
                .AddAspNetCoreInstrumentation(options =>
                    options.Filter = context => !UntracedPaths.Any(path => context.Request.Path.StartsWithSegments(path, StringComparison.Ordinal)))
                // Covers the YARP gateway too: its forwarder runs on SocketsHttpHandler, which emits the same activities.
                .AddHttpClientInstrumentation())
            // Endpoint, protocol, headers and service name come from the OTEL_* variables the AppHost sets.
            .UseOtlpExporter();
    }
}
