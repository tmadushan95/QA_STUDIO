using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Projects.Common;

namespace QaStudio.Application.Features.Projects.GetProject;

/// <summary>Gets one project.</summary>
/// <param name="Id">The key.</param>
public sealed record GetProjectQuery(int Id) : IQuery<ProjectResponse>;
