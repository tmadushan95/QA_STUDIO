using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Features.Insights.GetInsights;

/// <summary>Reads aggregate counts over the test library for the dashboard.</summary>
/// <param name="Days">How many days of "added per day" to return (1 to 365).</param>
/// <param name="ProjectId">Only this project, when given (the project the person is working in).</param>
/// <param name="VersionId">Only this version, when given.</param>
public sealed record GetInsightsQuery(int Days = 30, int? ProjectId = null, int? VersionId = null) : IQuery<InsightsData>;
