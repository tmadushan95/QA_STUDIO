using System.Net.Http.Headers;
using Microsoft.Extensions.Options;
using QaStudio.Api.Common;
using QaStudio.Api.Security;
using QaStudio.Infrastructure;
using Yarp.ReverseProxy.Configuration;
using Yarp.ReverseProxy.Forwarder;
using Yarp.ReverseProxy.Transforms;

namespace QaStudio.Api.Gateway;

/// <summary>
/// Forwards what only the Node worker can do (Playwright runs, Excel, the step library, AI, live events) so the frontend
/// talks to one API. Endpoints this API implements are more specific routes and always win over the catch-all.
/// </summary>
public static class WorkerGatewayExtensions
{
    private const string ClusterId = "worker";

    /// <summary>Adds the reverse proxy.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection.</returns>
    public static IServiceCollection AddWorkerGateway(this IServiceCollection services)
    {
        // Built from the final options on first use; configuration is not final while services are being registered.
        services.AddSingleton<IProxyConfigProvider>(provider => new InMemoryConfigProvider(
            [new RouteConfig { RouteId = "worker-api", ClusterId = ClusterId, Match = new RouteMatch { Path = "/api/{**rest}" } }],
            [
                new ClusterConfig
                {
                    ClusterId = ClusterId,
                    Destinations = new Dictionary<string, DestinationConfig>(StringComparer.Ordinal)
                    {
                        ["worker"] = new() { Address = provider.GetRequiredService<IOptions<WorkerOptions>>().Value.BaseUrl.ToString() },
                    },
                    // Model calls and page exploration can run for minutes; live events stay open indefinitely.
                    HttpRequest = new ForwarderRequestConfig { ActivityTimeout = TimeSpan.FromMinutes(15) },
                },
            ]));
        services.AddReverseProxy()
            .AddTransforms(context =>
            {
                var token = context.Services.GetRequiredService<IOptions<SecurityOptions>>().Value.AdminToken;
                // This edge has already checked Origin and the session. The worker would judge Origin against its own
                // address and refuse, and it has no sessions of its own, so it gets the token instead.
                context.AddRequestHeaderRemove("Origin");
                context.AddRequestHeaderRemove("Sec-Fetch-Site");
                context.AddRequestHeaderRemove("Cookie");
                context.AddRequestTransform(request =>
                {
                    request.ProxyRequest.Headers.Authorization =
                        string.IsNullOrEmpty(token) ? null : new AuthenticationHeaderValue("Bearer", token);
                    return ValueTask.CompletedTask;
                });
            });
        return services;
    }

    /// <summary>Maps the proxy, reporting a stopped worker in the API's normal error shape.</summary>
    /// <param name="routes">The route builder.</param>
    /// <returns>The same builder.</returns>
    public static IEndpointRouteBuilder MapWorkerGateway(this IEndpointRouteBuilder routes)
    {
        routes.MapReverseProxy(pipeline => pipeline.Use(async (context, next) =>
        {
            await next().ConfigureAwait(false);
            if (context.GetForwarderErrorFeature() is not null && !context.Response.HasStarted)
            {
                context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
                await context.Response.WriteAsJsonAsync(new ErrorResponse(new ErrorBody(
                    "worker-unavailable",
                    "The test runner service is not running. Test case and project pages still work; start it to run tests."))).ConfigureAwait(false);
            }
        }));
        return routes;
    }
}

