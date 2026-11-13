namespace QaStudio.Application.Features.TestSuites.Common;

/// <summary>A test suite as the API shows it. Every suite use case answers with this same shape, so it is shared.</summary>
public sealed record TestSuiteResponse
{
    /// <summary>The key.</summary>
    public required int Id { get; init; }

    /// <summary>The project's key.</summary>
    public required int ProjectId { get; init; }

    /// <summary>The project's name.</summary>
    public required string ProjectName { get; init; }

    /// <summary>Display name.</summary>
    public required string Name { get; init; }

    /// <summary>Optional description.</summary>
    public string? Description { get; init; }

    /// <summary>Position in the list.</summary>
    public required int SortOrder { get; init; }

    /// <summary>Whether it is offered for new test cases.</summary>
    public required bool IsActive { get; init; }

    /// <summary>How many test cases it holds.</summary>
    public required int TestCaseCount { get; init; }

    /// <summary>Send back when updating, so a stale edit is refused.</summary>
    public required string RowVersion { get; init; }
}
