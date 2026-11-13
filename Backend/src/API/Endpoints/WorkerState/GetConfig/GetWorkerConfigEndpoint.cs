using System.Text.Json;
using QaStudio.Api.Common;
using QaStudio.Api.Security;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.WorkerState.GetWorkerConfig;

namespace QaStudio.Api.Endpoints.WorkerState.GetConfig;

/// <summary>
/// GET /internal/persistence/config?prefix=pages: configuration blocks for the worker, which takes them again before a run in
/// case a change notice was missed. Guarded by the internal secret.
/// </summary>
public sealed class GetWorkerConfigEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.WorkerConfig, async (string prefix, IDispatcher dispatcher, CancellationToken ct) =>
        {
            var blocks = await dispatcher.SendAsync(new GetWorkerConfigQuery(prefix), ct).ConfigureAwait(false);
            return TypedResults.Ok(new ItemsResponse<WorkerConfigBlock>([.. blocks.Select(b => new WorkerConfigBlock(b.Key, JsonDocument.Parse(b.Value).RootElement.Clone()))]));
        }).AddEndpointFilter<InternalTokenFilter>().ExcludeFromDescription();
}

/// <summary>One configuration block.</summary>
/// <param name="Key">Its name.</param>
/// <param name="Value">Its value.</param>
public sealed record WorkerConfigBlock(string Key, JsonElement Value);
