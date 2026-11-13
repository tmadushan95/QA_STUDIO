namespace QaStudio.Core.TestCases;

/// <summary>The written content of a test case. Grouped so create and update cannot drift apart.</summary>
public sealed record TestCaseContent
{
    /// <summary>The stored form of an empty list.</summary>
    public const string EmptyJsonList = "[]";

    /// <summary>One-line title.</summary>
    public required string Title { get; init; }

    /// <summary>Optional longer description.</summary>
    public string? Description { get; init; }

    /// <summary>Module name as written in the source workbook.</summary>
    public string? Module { get; init; }

    /// <summary>What must be true before the case starts.</summary>
    public string? Preconditions { get; init; }

    /// <summary>The overall expected result.</summary>
    public string? ExpectedResult { get; init; }

    /// <summary>Priority label.</summary>
    public string? Priority { get; init; }

    /// <summary>Severity label.</summary>
    public string? Severity { get; init; }

    /// <summary>Type label, such as Regression.</summary>
    public string? TestType { get; init; }

    /// <summary>The role the case runs as.</summary>
    public string? UserRole { get; init; }

    /// <summary>Tags as a JSON array.</summary>
    public string TagsJson { get; init; } = EmptyJsonList;

    /// <summary>IDs of prerequisite cases as a JSON array.</summary>
    public string DependsOnJson { get; init; } = EmptyJsonList;

    /// <summary>Automation readiness label.</summary>
    public string Readiness { get; init; } = TestCaseReadiness.NeedsClarification;

    /// <summary>Where the case came from.</summary>
    public required TestCaseSource Source { get; init; }
}
