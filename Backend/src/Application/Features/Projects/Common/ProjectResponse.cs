namespace QaStudio.Application.Features.Projects.Common;

/// <summary>A project as the API shows it. Every project use case answers with this same shape, so it is shared.</summary>
public sealed record ProjectResponse
{
    /// <summary>The key.</summary>
    public required int Id { get; init; }

    /// <summary>Unique code.</summary>
    public required string Code { get; init; }

    /// <summary>Display name.</summary>
    public required string Name { get; init; }

    /// <summary>Optional description.</summary>
    public string? Description { get; init; }

    /// <summary>Whether it is offered for new test cases.</summary>
    public required bool IsActive { get; init; }

    /// <summary>How many suites it has.</summary>
    public required int SuiteCount { get; init; }

    /// <summary>How many test cases are under it.</summary>
    public required int TestCaseCount { get; init; }

    /// <summary>Send back when updating, so a stale edit is refused.</summary>
    public required string RowVersion { get; init; }
}
