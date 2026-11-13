using QaStudio.Application.Features.TestCases.Common;

namespace QaStudio.Api.Endpoints.TestCases.UpdateTestCase;

/// <summary>The body of an update request: the written content, where it goes, and the version it was based on.</summary>
public sealed record UpdateTestCaseRequest : TestCaseInput
{
    /// <summary>The suite to file it under.</summary>
    public int TestSuiteId { get; init; }

    /// <summary>The version the editor opened.</summary>
    public string? RowVersion { get; init; }
}
