using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.ProjectVersions.CreateProjectVersion;

namespace QaStudio.Api.Endpoints.ProjectVersions.CreateProjectVersion;

/// <summary>POST /api/project-versions.</summary>
public sealed class CreateProjectVersionEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPost(ApiRoutes.ProjectVersions, async (CreateProjectVersionRequest request, IDispatcher dispatcher, CancellationToken ct) =>
        {
            var created = await dispatcher.SendAsync(
                new CreateProjectVersionCommand(request.ProjectId, request.Name, request.Description, request.ReleaseDate, request.IsCurrent),
                ct).ConfigureAwait(false);
            return TypedResults.Created($"{ApiRoutes.ProjectVersions}/{created.Id}", created);
        }).WithTags(ApiTags.ProjectVersions).WithName("CreateProjectVersion");
}
