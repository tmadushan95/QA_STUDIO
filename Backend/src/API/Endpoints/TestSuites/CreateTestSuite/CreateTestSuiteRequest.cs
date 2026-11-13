namespace QaStudio.Api.Endpoints.TestSuites.CreateTestSuite;

/// <summary>The body of a create-suite request.</summary>
/// <param name="ProjectId">The project's key.</param>
/// <param name="Name">Display name.</param>
/// <param name="Description">Optional description.</param>
/// <param name="SortOrder">Position in the list.</param>
public sealed record CreateTestSuiteRequest(int ProjectId, string? Name, string? Description, int SortOrder = 0);
