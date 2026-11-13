using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Audit.ListAudit;

namespace QaStudio.Api.Endpoints.Audit.ListAudit;

/// <summary>GET /api/audit: served here because it must include changes made by this API as well as by the worker.</summary>
public sealed class ListAuditEndpoint : IEndpoint
{
    private const int DefaultLimit = 100;

    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.Audit, async (int? limit, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(new ItemsResponse<AuditResponse>(await dispatcher.SendAsync(new ListAuditQuery(limit ?? DefaultLimit), ct).ConfigureAwait(false))))
            .WithTags(ApiTags.System).WithName("ListAudit");
}
