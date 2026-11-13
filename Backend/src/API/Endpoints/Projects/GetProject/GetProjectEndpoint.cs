using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Projects.GetProject;

namespace QaStudio.Api.Endpoints.Projects.GetProject;

/// <summary>GET /api/projects/{id}.</summary>
public sealed class GetProjectEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.Project, async (int id, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new GetProjectQuery(id), ct).ConfigureAwait(false)))
            .WithTags(ApiTags.Projects).WithName("GetProject");
}
