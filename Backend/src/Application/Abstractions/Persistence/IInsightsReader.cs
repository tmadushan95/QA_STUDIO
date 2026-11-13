namespace QaStudio.Application.Abstractions;

/// <summary>
/// Aggregate counts over the test library for the dashboard. Read with hand-written SQL (Dapper): the answers are
/// GROUP BY projections that EF would either translate poorly or load whole entities for.
/// </summary>
public interface IInsightsReader
{
    /// <summary>Counts the library by project, version, suite, priority and readiness, and recent additions by day.</summary>
    /// <param name="sinceUtc">The first day counted in <see cref="InsightsData.AddedPerDay"/>.</param>
    /// <param name="projectId">Only this project's cases, when given.</param>
    /// <param name="versionId">Only this version's cases, when given.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The counts.</returns>
    Task<InsightsData> ReadAsync(DateTime sinceUtc, int? projectId, int? versionId, CancellationToken cancellationToken);
}
