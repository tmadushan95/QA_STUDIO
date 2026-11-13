using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Projects.Common;
using QaStudio.Application.Features.Projects.ListProjects;

namespace QaStudio.Api.Endpoints.Projects.ListProjects;

/// <summary>GET /api/projects.</summary>
public sealed class ListProjectsEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.Projects, async (IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(new ItemsResponse<ProjectResponse>(await dispatcher.SendAsync(new ListProjectsQuery(), ct).ConfigureAwait(false))))
            .WithTags(ApiTags.Projects).WithName("ListProjects");
}
