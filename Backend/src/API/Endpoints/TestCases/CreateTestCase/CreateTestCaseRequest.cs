using QaStudio.Application.Features.TestCases.Common;

namespace QaStudio.Api.Endpoints.TestCases.CreateTestCase;

/// <summary>The body of a create request: the written content, plus where it goes.</summary>
public sealed record CreateTestCaseRequest : TestCaseInput
{
    /// <summary>The case ID; left out, the next free one is assigned.</summary>
    public string? Id { get; init; }

    /// <summary>The suite to file it under.</summary>
    public int TestSuiteId { get; init; }

    /// <summary>The project version the case is written for, when one is chosen.</summary>
    public int? ProjectVersionId { get; init; }
}
