using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.ProjectVersions.DeleteProjectVersion;

namespace QaStudio.Api.Endpoints.ProjectVersions.DeleteProjectVersion;

/// <summary>DELETE /api/project-versions/{id}. The version's test cases are kept, with no version.</summary>
public sealed class DeleteProjectVersionEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapDelete(ApiRoutes.ProjectVersion, async (int id, IDispatcher dispatcher, CancellationToken ct) =>
        {
            await dispatcher.SendAsync(new DeleteProjectVersionCommand(id), ct).ConfigureAwait(false);
            return TypedResults.NoContent();
        }).WithTags(ApiTags.ProjectVersions).WithName("DeleteProjectVersion");
}
