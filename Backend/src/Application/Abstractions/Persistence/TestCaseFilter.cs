namespace QaStudio.Application.Abstractions;

/// <summary>Filter and page for listing test cases.</summary>
/// <param name="ProjectId">Only this project.</param>
/// <param name="TestSuiteId">Only this suite.</param>
/// <param name="ProjectVersionId">Only this project version.</param>
/// <param name="Search">Text in the ID, title or module.</param>
/// <param name="Module">Only this module.</param>
/// <param name="Priority">Only this priority.</param>
/// <param name="Page">One-based page.</param>
/// <param name="PageSize">Rows per page.</param>
public sealed record TestCaseFilter(
    int? ProjectId,
    int? TestSuiteId,
    int? ProjectVersionId,
    string? Search,
    string? Module,
    string? Priority,
    int Page,
    int PageSize);
