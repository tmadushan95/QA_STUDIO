using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Projects.Common;

namespace QaStudio.Application.Features.Projects.CreateProject;

/// <summary>Creates a project.</summary>
/// <param name="Code">Unique code.</param>
/// <param name="Name">Display name.</param>
/// <param name="Description">Optional description.</param>
public sealed record CreateProjectCommand(string? Code, string? Name, string? Description) : ICommand<ProjectResponse>;
