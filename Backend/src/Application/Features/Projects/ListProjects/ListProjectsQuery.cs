using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Projects.Common;

namespace QaStudio.Application.Features.Projects.ListProjects;

/// <summary>Lists every project with its counts.</summary>
public sealed record ListProjectsQuery : IQuery<IReadOnlyList<ProjectResponse>>;
