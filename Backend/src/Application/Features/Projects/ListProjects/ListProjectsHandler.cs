using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Projects.Common;

namespace QaStudio.Application.Features.Projects.ListProjects;

/// <summary>Handles <see cref="ListProjectsQuery"/>.</summary>
/// <param name="responses">Builds responses.</param>
internal sealed class ListProjectsHandler(ProjectResponseBuilder responses)
    : IRequestHandler<ListProjectsQuery, IReadOnlyList<ProjectResponse>>
{
    public Task<IReadOnlyList<ProjectResponse>> HandleAsync(ListProjectsQuery request, CancellationToken cancellationToken) =>
        responses.BuildAllAsync(cancellationToken);
}
