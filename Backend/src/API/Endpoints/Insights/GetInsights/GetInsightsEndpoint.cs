using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Insights.GetInsights;

namespace QaStudio.Api.Endpoints.Insights.GetInsights;

/// <summary>GET /api/insights: library counts for the dashboard (by project, version, suite, priority, readiness).</summary>
public sealed class GetInsightsEndpoint : IEndpoint
{
    private const int DefaultDays = 30;

    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.Insights, async (int? days, int? projectId, int? versionId, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new GetInsightsQuery(days ?? DefaultDays, projectId, versionId), ct).ConfigureAwait(false)))
            .WithTags(ApiTags.System).WithName("GetInsights");
}
