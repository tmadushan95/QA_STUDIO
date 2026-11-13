using QaStudio.Api.Common;
using QaStudio.Api.Security;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.WorkerState.GetWorkerSnapshot;

namespace QaStudio.Api.Endpoints.WorkerState.GetSnapshot;

/// <summary>GET /internal/persistence/snapshot: everything the worker loads when it starts.</summary>
public sealed class GetSnapshotEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.WorkerSnapshot, async (IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new GetWorkerSnapshotQuery(), ct).ConfigureAwait(false)))
            .AddEndpointFilter<InternalTokenFilter>().ExcludeFromDescription();
}
