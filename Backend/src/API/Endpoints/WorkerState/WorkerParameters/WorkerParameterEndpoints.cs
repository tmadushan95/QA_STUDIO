using QaStudio.Api.Common;
using QaStudio.Api.Endpoints.Parameters.AutoConfigureParameters;
using QaStudio.Api.Security;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.AutoConfigureParameters;
using QaStudio.Application.Features.WorkerState.WorkerParameters;

namespace QaStudio.Api.Endpoints.WorkerState.WorkerParameters;

/// <summary>The body of POST /internal/persistence/parameters/effective.</summary>
/// <param name="CaseIds">The cases about to run.</param>
public sealed record EffectiveRequest(List<string>? CaseIds);

/// <summary>The body of POST /internal/persistence/parameters/import.</summary>
/// <param name="Values">Case to name to value.</param>
public sealed record ImportRequest(Dictionary<string, Dictionary<string, string>>? Values);

/// <summary>
/// The worker's routes for parameter values, guarded by the internal secret: the values a run uses (asked before every run, so
/// the worker holds no copy that could go stale), export and import for backups, clear, and auto-fill for the Azure DevOps pipeline.
/// </summary>
public sealed class WorkerParameterEndpoints : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes)
    {
        routes.MapPost(ApiRoutes.WorkerParameters + "/effective", async (EffectiveRequest request, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(new { items = await dispatcher.SendAsync(new GetEffectiveParametersQuery(request.CaseIds ?? []), ct).ConfigureAwait(false) }))
            .AddEndpointFilter<InternalTokenFilter>().ExcludeFromDescription();
        routes.MapGet(ApiRoutes.WorkerParameters + "/export", async (IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(new { items = await dispatcher.SendAsync(new ExportParametersQuery(), ct).ConfigureAwait(false) }))
            .AddEndpointFilter<InternalTokenFilter>().ExcludeFromDescription();
        routes.MapPost(ApiRoutes.WorkerParameters + "/import", async (ImportRequest request, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(new
            {
                imported = await dispatcher.SendAsync(
                    new ImportParametersCommand((request.Values ?? []).ToDictionary(c => c.Key, c => (IReadOnlyDictionary<string, string>)c.Value, StringComparer.Ordinal)),
                    ct).ConfigureAwait(false),
            }))
            .AddEndpointFilter<InternalTokenFilter>().ExcludeFromDescription();
        routes.MapDelete(ApiRoutes.WorkerParameters, async (IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(new { deleted = await dispatcher.SendAsync(new ClearParametersCommand(), ct).ConfigureAwait(false) }))
            .AddEndpointFilter<InternalTokenFilter>().ExcludeFromDescription();
        routes.MapPost(ApiRoutes.WorkerParameters + "/auto", async (AutoConfigureRequest request, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new AutoConfigureParametersCommand(request.CaseIds ?? [], request.Ai != false), ct).ConfigureAwait(false)))
            .AddEndpointFilter<InternalTokenFilter>().ExcludeFromDescription();
    }
}
