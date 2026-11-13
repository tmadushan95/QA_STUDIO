using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.ProjectVersions.Common;

namespace QaStudio.Application.Features.ProjectVersions.ListProjectVersions;

/// <summary>Handles <see cref="ListProjectVersionsQuery"/>.</summary>
/// <param name="responses">Builds responses.</param>
internal sealed class ListProjectVersionsHandler(ProjectVersionResponseBuilder responses)
    : IRequestHandler<ListProjectVersionsQuery, IReadOnlyList<ProjectVersionResponse>>
{
    public Task<IReadOnlyList<ProjectVersionResponse>> HandleAsync(ListProjectVersionsQuery request, CancellationToken cancellationToken) =>
        responses.BuildAllAsync(request.ProjectId, cancellationToken);
}
