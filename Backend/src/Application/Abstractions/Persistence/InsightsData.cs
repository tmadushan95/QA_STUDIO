namespace QaStudio.Application.Abstractions;

/// <summary>One labelled count, such as a priority and how many cases have it.</summary>
/// <param name="Key">The group's key: an ID as text, or the label itself.</param>
/// <param name="Label">What people read.</param>
/// <param name="Count">How many.</param>
public sealed record CountItem(string Key, string Label, int Count);

/// <summary>Test cases added on one day.</summary>
/// <param name="Day">The UTC day.</param>
/// <param name="Count">How many were added.</param>
public sealed record DayCount(DateOnly Day, int Count);

/// <summary>Aggregate counts over the test library.</summary>
public sealed record InsightsData
{
    /// <summary>Every test case.</summary>
    public required int TotalCases { get; init; }

    /// <summary>Every project.</summary>
    public required int TotalProjects { get; init; }

    /// <summary>Every suite.</summary>
    public required int TotalSuites { get; init; }

    /// <summary>Every project version.</summary>
    public required int TotalVersions { get; init; }

    /// <summary>Cases per project, largest first.</summary>
    public required IReadOnlyList<CountItem> ByProject { get; init; }

    /// <summary>Cases per project version ("Project · Version"), largest first. Cases with no version are left out.</summary>
    public required IReadOnlyList<CountItem> ByVersion { get; init; }

    /// <summary>Cases per suite, largest first, at most 10.</summary>
    public required IReadOnlyList<CountItem> BySuite { get; init; }

    /// <summary>Cases per priority label; "(none)" for cases without one.</summary>
    public required IReadOnlyList<CountItem> ByPriority { get; init; }

    /// <summary>Cases per automation readiness.</summary>
    public required IReadOnlyList<CountItem> ByReadiness { get; init; }

    /// <summary>Cases added per day since the requested day; days with none are absent.</summary>
    public required IReadOnlyList<DayCount> AddedPerDay { get; init; }
}
