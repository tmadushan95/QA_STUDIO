using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Pages.Common;
using QaStudio.Application.Features.Pages.ListPages;

namespace QaStudio.Api.Endpoints.Pages.ListPages;

/// <summary>GET /api/pages: the shared page list, or one project's own list with <c>?projectId=</c>.</summary>
public sealed class ListPagesEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.Pages, async (int? projectId, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(new ItemsResponse<PageEntry>(await dispatcher.SendAsync(new ListPagesQuery(projectId), ct).ConfigureAwait(false))))
            .WithTags(ApiTags.System).WithName("ListPages");
}
