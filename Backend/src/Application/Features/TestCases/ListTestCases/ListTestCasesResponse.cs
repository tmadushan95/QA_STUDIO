using QaStudio.Application.Features.TestCases.Common;

namespace QaStudio.Application.Features.TestCases.ListTestCases;

/// <summary>One page of test cases.</summary>
/// <param name="Total">How many match in all.</param>
/// <param name="Page">One-based page.</param>
/// <param name="PageSize">Rows per page.</param>
/// <param name="Items">This page's rows.</param>
public sealed record ListTestCasesResponse(int Total, int Page, int PageSize, IReadOnlyList<TestCaseResponse> Items);
