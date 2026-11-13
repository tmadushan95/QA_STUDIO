namespace QaStudio.Application.Abstractions;

/// <summary>A test suite as listed; plain data, so it is safe to cache.</summary>
/// <param name="Id">The key.</param>
/// <param name="ProjectId">The project's key.</param>
/// <param name="Name">Display name.</param>
/// <param name="Description">Optional description.</param>
/// <param name="SortOrder">Position in the list.</param>
/// <param name="IsActive">Whether it is offered for new cases.</param>
/// <param name="RowVersion">Concurrency token, base64.</param>
public sealed record TestSuiteItem(int Id, int ProjectId, string Name, string? Description, int SortOrder, bool IsActive, string RowVersion);
