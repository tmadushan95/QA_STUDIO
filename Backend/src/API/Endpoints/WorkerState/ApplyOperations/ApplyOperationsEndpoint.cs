using QaStudio.Api.Common;
using QaStudio.Api.Security;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.WorkerState.ApplyWorkerOperations;

namespace QaStudio.Api.Endpoints.WorkerState.ApplyOperations;

/// <summary>POST /internal/persistence/batch: applies the worker's writes in one transaction.</summary>
public sealed class ApplyOperationsEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPost(ApiRoutes.WorkerBatch, async (ApplyOperationsRequest request, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new ApplyWorkerOperationsCommand(request.Operations), ct).ConfigureAwait(false)))
            .AddEndpointFilter<InternalTokenFilter>().ExcludeFromDescription();
}
