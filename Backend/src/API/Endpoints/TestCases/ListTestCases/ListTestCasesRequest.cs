using Microsoft.AspNetCore.Mvc;

namespace QaStudio.Api.Endpoints.TestCases.ListTestCases;

/// <summary>The query string of the list route.</summary>
/// <param name="ProjectId">Only this project.</param>
/// <param name="TestSuiteId">Only this suite.</param>
/// <param name="ProjectVersionId">Only this project version.</param>
/// <param name="Q">Text in the ID, title or module.</param>
/// <param name="Module">Only this module.</param>
/// <param name="Priority">Only this priority.</param>
/// <param name="Page">One-based page.</param>
/// <param name="PageSize">Rows per page, within the configured limit.</param>
public sealed record ListTestCasesRequest(
    [FromQuery] int? ProjectId,
    [FromQuery] int? TestSuiteId,
    [FromQuery] int? ProjectVersionId,
    [FromQuery] string? Q,
    [FromQuery] string? Module,
    [FromQuery] string? Priority,
    [FromQuery] int? Page,
    [FromQuery] int? PageSize);
