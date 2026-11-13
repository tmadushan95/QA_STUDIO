using QaStudio.Application.Features.TestCases.Common;

namespace QaStudio.Application.Features.WorkerState.ApplyWorkerOperations.Strategies;

/// <summary>The stored shape of a test case in the worker's JSON. Its rules are checked by the domain, not on reading.</summary>
internal sealed record WorkerTestCase
{
    /// <summary>The case ID.</summary>
    public string Id { get; init; } = string.Empty;

    /// <summary>One-line title.</summary>
    public string Title { get; init; } = string.Empty;

    /// <summary>Optional longer description.</summary>
    public string? Description { get; init; }

    /// <summary>Module name.</summary>
    public string? Module { get; init; }

    /// <summary>What must be true first.</summary>
    public string? Preconditions { get; init; }

    /// <summary>Written steps.</summary>
    public IReadOnlyList<TestStepResponse>? Steps { get; init; }

    /// <summary>Overall expected result.</summary>
    public string? ExpectedResult { get; init; }

    /// <summary>Priority label.</summary>
    public string? Priority { get; init; }

    /// <summary>Severity label.</summary>
    public string? Severity { get; init; }

    /// <summary>Type label.</summary>
    public string? TestType { get; init; }

    /// <summary>The role it runs as.</summary>
    public string? UserRole { get; init; }

    /// <summary>Tags.</summary>
    public IReadOnlyList<string>? Tags { get; init; }

    /// <summary>Prerequisite IDs.</summary>
    public IReadOnlyList<string>? DependsOn { get; init; }

    /// <summary>Readiness label.</summary>
    public string? Readiness { get; init; }

    /// <summary>Traceability.</summary>
    public TestCaseSourceResponse? Source { get; init; }

    /// <summary>
    /// Filing hint: the suite a new case should go to (chosen on the Test Design page or an Azure DevOps import).
    /// Ignored for a case that already exists, whose filing is decided by people in the API.
    /// </summary>
    public int? TestSuiteId { get; init; }

    /// <summary>
    /// Filing hint: the project a new case belongs to when no suite is chosen. Its module becomes a suite of that
    /// project (instead of the default project). Ignored for an existing case.
    /// </summary>
    public int? ProjectId { get; init; }

    /// <summary>Filing hint: the project version a new case is written for. Ignored for an existing case.</summary>
    public int? ProjectVersionId { get; init; }
}
