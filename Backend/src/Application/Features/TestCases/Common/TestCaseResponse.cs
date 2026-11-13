namespace QaStudio.Application.Features.TestCases.Common;

/// <summary>
/// A test case as the API shows it. The core fields match the worker's <c>TestCase</c> schema exactly, so a response
/// can be sent to the worker unchanged. Create, update and get all answer with this same shape, so it is shared.
/// </summary>
public sealed record TestCaseResponse
{
    /// <summary>The document version the worker's schema expects.</summary>
    public const int CurrentSchemaVersion = 1;

    /// <summary>Document version.</summary>
    public int SchemaVersion { get; init; } = CurrentSchemaVersion;

    /// <summary>The case ID, such as TC_01.</summary>
    public required string Id { get; init; }

    /// <summary>One-line title.</summary>
    public required string Title { get; init; }

    /// <summary>Optional longer description.</summary>
    public string? Description { get; init; }

    /// <summary>Module name from the source.</summary>
    public string? Module { get; init; }

    /// <summary>What must be true first.</summary>
    public string? Preconditions { get; init; }

    /// <summary>Written steps.</summary>
    public required IReadOnlyList<TestStepResponse> Steps { get; init; }

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
    public required IReadOnlyList<string> Tags { get; init; }

    /// <summary>IDs of prerequisite cases.</summary>
    public required IReadOnlyList<string> DependsOn { get; init; }

    /// <summary>Automation readiness.</summary>
    public required string Readiness { get; init; }

    /// <summary>Where it came from.</summary>
    public required TestCaseSourceResponse Source { get; init; }

    /// <summary>The suite's key.</summary>
    public required int TestSuiteId { get; init; }

    /// <summary>The suite's name.</summary>
    public required string TestSuiteName { get; init; }

    /// <summary>The project's key. A run uses this project's address and sign-in.</summary>
    public required int ProjectId { get; init; }

    /// <summary>The project's name.</summary>
    public required string ProjectName { get; init; }

    /// <summary>The project version's key, when the case has one.</summary>
    public int? ProjectVersionId { get; init; }

    /// <summary>The project version's name, when the case has one.</summary>
    public string? ProjectVersionName { get; init; }

    /// <summary>Send back when updating, so a stale edit is refused.</summary>
    public required string RowVersion { get; init; }
}
