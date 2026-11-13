using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.ProjectVersions.Common;

namespace QaStudio.Application.Features.ProjectVersions.UpdateProjectVersion;

/// <summary>Updates a version.</summary>
/// <param name="Id">The key.</param>
/// <param name="Name">Display name.</param>
/// <param name="Description">Optional description.</param>
/// <param name="ReleaseDate">Optional release date.</param>
/// <param name="IsCurrent">Whether it is the project's current version.</param>
/// <param name="IsActive">Whether it is offered for new test cases.</param>
/// <param name="RowVersion">The version the editor opened.</param>
public sealed record UpdateProjectVersionCommand(
    int Id,
    string? Name,
    string? Description,
    DateOnly? ReleaseDate,
    bool IsCurrent,
    bool IsActive,
    string? RowVersion) : ICommand<ProjectVersionResponse>;
