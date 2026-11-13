using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Projects.DeleteProject;

namespace QaStudio.Api.Endpoints.Projects.DeleteProject;

/// <summary>DELETE /api/projects/{id}.</summary>
public sealed class DeleteProjectEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapDelete(ApiRoutes.Project, async (int id, IDispatcher dispatcher, CancellationToken ct) =>
        {
            await dispatcher.SendAsync(new DeleteProjectCommand(id), ct).ConfigureAwait(false);
            return TypedResults.NoContent();
        }).WithTags(ApiTags.Projects).WithName("DeleteProject");
}
