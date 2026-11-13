namespace QaStudio.Api.Endpoints.ProjectVersions.UpdateProjectVersion;

/// <summary>The body of an update-version request.</summary>
/// <param name="Name">Display name.</param>
/// <param name="Description">Optional description.</param>
/// <param name="ReleaseDate">Optional release date (yyyy-MM-dd).</param>
/// <param name="IsCurrent">Whether it is the project's current version.</param>
/// <param name="IsActive">Whether it is offered for new test cases.</param>
/// <param name="RowVersion">The version the editor opened.</param>
public sealed record UpdateProjectVersionRequest(
    string? Name,
    string? Description,
    DateOnly? ReleaseDate,
    bool IsCurrent = false,
    bool IsActive = true,
    string? RowVersion = null);
