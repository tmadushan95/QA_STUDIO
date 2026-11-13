using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestSuites.Common;

namespace QaStudio.Application.Features.TestSuites.UpdateTestSuite;

/// <summary>Updates a suite.</summary>
/// <param name="Id">The key.</param>
/// <param name="Name">Display name.</param>
/// <param name="Description">Optional description.</param>
/// <param name="SortOrder">Position in the list.</param>
/// <param name="IsActive">Whether it is offered for new test cases.</param>
/// <param name="RowVersion">The version the editor opened.</param>
public sealed record UpdateTestSuiteCommand(int Id, string? Name, string? Description, int SortOrder, bool IsActive, string? RowVersion)
    : ICommand<TestSuiteResponse>;
