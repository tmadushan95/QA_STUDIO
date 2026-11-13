namespace QaStudio.Api.Endpoints.Projects.CreateProject;

/// <summary>The body of a create-project request.</summary>
/// <param name="Code">Unique code.</param>
/// <param name="Name">Display name.</param>
/// <param name="Description">Optional description.</param>
public sealed record CreateProjectRequest(string? Code, string? Name, string? Description);
