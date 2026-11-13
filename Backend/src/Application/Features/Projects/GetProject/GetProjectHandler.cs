using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Projects.Common;

namespace QaStudio.Application.Features.Projects.GetProject;

/// <summary>Handles <see cref="GetProjectQuery"/>.</summary>
/// <param name="responses">Builds responses.</param>
internal sealed class GetProjectHandler(ProjectResponseBuilder responses) : IRequestHandler<GetProjectQuery, ProjectResponse>
{
    public Task<ProjectResponse> HandleAsync(GetProjectQuery request, CancellationToken cancellationToken) =>
        responses.BuildAsync(request.Id, cancellationToken);
}
