using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Pages.Common;
using QaStudio.Application.Features.Pages.UpdatePages;

namespace QaStudio.Api.Endpoints.Pages.UpdatePages;

/// <summary>PUT /api/pages: replaces the shared page list, or one project's own list.</summary>
public sealed class UpdatePagesEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPut(ApiRoutes.Pages, async (UpdatePagesRequest request, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(new ItemsResponse<PageEntry>(await dispatcher.SendAsync(new UpdatePagesCommand([.. (request.Pages ?? []).Select(p => p.ToEntry())], request.ProjectId), ct).ConfigureAwait(false))))
            .WithTags(ApiTags.System).WithName("UpdatePages");
}
