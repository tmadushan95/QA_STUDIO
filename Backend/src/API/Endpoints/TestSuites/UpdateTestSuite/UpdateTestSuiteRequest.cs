namespace QaStudio.Api.Endpoints.TestSuites.UpdateTestSuite;

/// <summary>The body of an update-suite request.</summary>
/// <param name="Name">Display name.</param>
/// <param name="Description">Optional description.</param>
/// <param name="SortOrder">Position in the list.</param>
/// <param name="IsActive">Whether it is offered for new test cases.</param>
/// <param name="RowVersion">The version the editor opened.</param>
public sealed record UpdateTestSuiteRequest(string? Name, string? Description, int SortOrder = 0, bool IsActive = true, string? RowVersion = null);
