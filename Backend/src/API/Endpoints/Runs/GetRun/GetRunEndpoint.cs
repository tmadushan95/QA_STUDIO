using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Runs.GetRun;

namespace QaStudio.Api.Endpoints.Runs.GetRun;

/// <summary>GET /api/runs/{id}: one run with its per-case results. Sub-routes (report, artifact, cancel) go to the worker.</summary>
public sealed class GetRunEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.Run, async (string id, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new GetRunQuery(id), ct).ConfigureAwait(false)))
            .WithTags(ApiTags.System).WithName("GetRun");
}
