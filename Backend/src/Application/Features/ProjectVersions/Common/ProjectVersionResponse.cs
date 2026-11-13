namespace QaStudio.Application.Features.ProjectVersions.Common;

/// <summary>A project version as the API shows it. Every version use case answers with this shape, so it is shared.</summary>
public sealed record ProjectVersionResponse
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

    /// <summary>Optional release date, as yyyy-MM-dd.</summary>
    public DateOnly? ReleaseDate { get; init; }

    /// <summary>Whether new cases of the project are filed under it by default.</summary>
    public required bool IsCurrent { get; init; }

    /// <summary>Whether it is offered for new test cases.</summary>
    public required bool IsActive { get; init; }

    /// <summary>How many test cases are filed under it.</summary>
    public required int TestCaseCount { get; init; }

    /// <summary>Send back when updating, so a stale edit is refused.</summary>
    public required string RowVersion { get; init; }
}
