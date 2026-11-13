using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Runs.ListRuns;

namespace QaStudio.Api.Endpoints.Runs.ListRuns;

/// <summary>
/// GET /api/runs: the run history, newest first, for one project and version when they are given. Starting, cancelling and
/// the reports and evidence of a run stay with the worker, which does the running.
/// </summary>
public sealed class ListRunsEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.Runs, async (int? projectId, int? versionId, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(new ItemsResponse<System.Text.Json.Nodes.JsonObject>(
                await dispatcher.SendAsync(new ListRunsQuery(projectId, versionId), ct).ConfigureAwait(false))))
            .WithTags(ApiTags.System).WithName("ListRuns");
}
