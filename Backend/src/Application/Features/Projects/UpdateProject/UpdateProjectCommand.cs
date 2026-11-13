using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Projects.Common;

namespace QaStudio.Application.Features.Projects.UpdateProject;

/// <summary>Updates a project.</summary>
/// <param name="Id">The key.</param>
/// <param name="Code">Unique code.</param>
/// <param name="Name">Display name.</param>
/// <param name="Description">Optional description.</param>
/// <param name="IsActive">Whether it is offered for new test cases.</param>
/// <param name="RowVersion">The version the editor opened.</param>
public sealed record UpdateProjectCommand(int Id, string? Code, string? Name, string? Description, bool IsActive, string? RowVersion)
    : ICommand<ProjectResponse>;
