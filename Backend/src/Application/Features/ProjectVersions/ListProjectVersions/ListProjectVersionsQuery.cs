using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.ProjectVersions.Common;

namespace QaStudio.Application.Features.ProjectVersions.ListProjectVersions;

/// <summary>Lists project versions.</summary>
/// <param name="ProjectId">Only this project's versions, when given.</param>
public sealed record ListProjectVersionsQuery(int? ProjectId) : IQuery<IReadOnlyList<ProjectVersionResponse>>;
