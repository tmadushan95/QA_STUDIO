using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.ProjectVersions.Common;

namespace QaStudio.Application.Features.ProjectVersions.CreateProjectVersion;

/// <summary>Creates a version under a project.</summary>
/// <param name="ProjectId">The project's key.</param>
/// <param name="Name">Display name.</param>
/// <param name="Description">Optional description.</param>
/// <param name="ReleaseDate">Optional release date.</param>
/// <param name="IsCurrent">Whether it becomes the project's current version.</param>
public sealed record CreateProjectVersionCommand(int ProjectId, string? Name, string? Description, DateOnly? ReleaseDate, bool IsCurrent)
    : ICommand<ProjectVersionResponse>;
