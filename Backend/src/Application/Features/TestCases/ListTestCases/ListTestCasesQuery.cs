using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Features.TestCases.ListTestCases;

/// <summary>Lists test cases, filtered and paged.</summary>
/// <param name="ProjectId">Only this project.</param>
/// <param name="TestSuiteId">Only this suite.</param>
/// <param name="ProjectVersionId">Only this project version.</param>
/// <param name="Search">Text in the ID, title or module.</param>
/// <param name="Module">Only this module.</param>
/// <param name="Priority">Only this priority.</param>
/// <param name="Page">One-based page.</param>
/// <param name="PageSize">Rows per page, within the configured limit.</param>
public sealed record ListTestCasesQuery(
    int? ProjectId,
    int? TestSuiteId,
    int? ProjectVersionId,
    string? Search,
    string? Module,
    string? Priority,
    int Page = 1,
    int PageSize = 25) : IQuery<ListTestCasesResponse>;
