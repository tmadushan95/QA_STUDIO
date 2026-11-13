using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Projects.CreateProject;

namespace QaStudio.Api.Endpoints.Projects.CreateProject;

/// <summary>POST /api/projects.</summary>
public sealed class CreateProjectEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPost(ApiRoutes.Projects, async (CreateProjectRequest request, IDispatcher dispatcher, CancellationToken ct) =>
        {
            var created = await dispatcher.SendAsync(new CreateProjectCommand(request.Code, request.Name, request.Description), ct).ConfigureAwait(false);
            return TypedResults.Created($"{ApiRoutes.Projects}/{created.Id}", created);
        }).WithTags(ApiTags.Projects).WithName("CreateProject");
}
