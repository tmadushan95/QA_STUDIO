namespace QaStudio.Api.Endpoints.ProjectVersions.CreateProjectVersion;

/// <summary>The body of a create-version request.</summary>
/// <param name="ProjectId">The project's key.</param>
/// <param name="Name">Display name, such as 2.4.0.</param>
/// <param name="Description">Optional description.</param>
/// <param name="ReleaseDate">Optional release date (yyyy-MM-dd).</param>
/// <param name="IsCurrent">Whether it becomes the project's current version.</param>
public sealed record CreateProjectVersionRequest(int ProjectId, string? Name, string? Description, DateOnly? ReleaseDate, bool IsCurrent = false);
