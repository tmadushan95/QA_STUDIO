using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Dashboard.GetDashboard;

namespace QaStudio.Api.Endpoints.Dashboard.GetDashboard;

/// <summary>
/// GET /api/dashboard: where testing stands (latest results, coverage, trend, failures), for one project and version when
/// they are given. Served here, from the database, since the data it reads already lives here; the worker no longer
/// answers it.
/// </summary>
public sealed class GetDashboardEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.Dashboard, async (int? projectId, int? versionId, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new GetDashboardQuery(projectId, versionId), ct).ConfigureAwait(false)))
            .WithTags(ApiTags.System).WithName("GetDashboard");
}
