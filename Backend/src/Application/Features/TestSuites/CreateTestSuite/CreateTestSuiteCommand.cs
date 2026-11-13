using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestSuites.Common;

namespace QaStudio.Application.Features.TestSuites.CreateTestSuite;

/// <summary>Creates a suite under a project.</summary>
/// <param name="ProjectId">The project's key.</param>
/// <param name="Name">Display name.</param>
/// <param name="Description">Optional description.</param>
/// <param name="SortOrder">Position in the list.</param>
public sealed record CreateTestSuiteCommand(int ProjectId, string? Name, string? Description, int SortOrder) : ICommand<TestSuiteResponse>;
