using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.ProjectVersions.Common;
using QaStudio.Application.Features.ProjectVersions.ListProjectVersions;

namespace QaStudio.Api.Endpoints.ProjectVersions.ListProjectVersions;

/// <summary>GET /api/project-versions, optionally for one project.</summary>
public sealed class ListProjectVersionsEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.ProjectVersions, async (int? projectId, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(new ItemsResponse<ProjectVersionResponse>(await dispatcher.SendAsync(new ListProjectVersionsQuery(projectId), ct).ConfigureAwait(false))))
            .WithTags(ApiTags.ProjectVersions).WithName("ListProjectVersions");
}
