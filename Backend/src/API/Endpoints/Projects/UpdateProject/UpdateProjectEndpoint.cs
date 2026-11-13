using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Projects.UpdateProject;

namespace QaStudio.Api.Endpoints.Projects.UpdateProject;

/// <summary>PUT /api/projects/{id}.</summary>
public sealed class UpdateProjectEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPut(ApiRoutes.Project, async (int id, UpdateProjectRequest request, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(
                new UpdateProjectCommand(id, request.Code, request.Name, request.Description, request.IsActive, request.RowVersion),
                ct).ConfigureAwait(false)))
            .WithTags(ApiTags.Projects).WithName("UpdateProject");
}
