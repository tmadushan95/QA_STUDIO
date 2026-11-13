using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.ProjectVersions.UpdateProjectVersion;

namespace QaStudio.Api.Endpoints.ProjectVersions.UpdateProjectVersion;

/// <summary>PUT /api/project-versions/{id}.</summary>
public sealed class UpdateProjectVersionEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPut(ApiRoutes.ProjectVersion, async (int id, UpdateProjectVersionRequest request, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(
                new UpdateProjectVersionCommand(id, request.Name, request.Description, request.ReleaseDate, request.IsCurrent, request.IsActive, request.RowVersion),
                ct).ConfigureAwait(false)))
            .WithTags(ApiTags.ProjectVersions).WithName("UpdateProjectVersion");
}
