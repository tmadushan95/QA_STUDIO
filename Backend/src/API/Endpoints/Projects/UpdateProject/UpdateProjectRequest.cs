namespace QaStudio.Api.Endpoints.Projects.UpdateProject;

/// <summary>The body of an update-project request.</summary>
/// <param name="Code">Unique code.</param>
/// <param name="Name">Display name.</param>
/// <param name="Description">Optional description.</param>
/// <param name="IsActive">Whether it is offered for new test cases.</param>
/// <param name="RowVersion">The version the editor opened.</param>
public sealed record UpdateProjectRequest(string? Code, string? Name, string? Description, bool IsActive = true, string? RowVersion = null);
