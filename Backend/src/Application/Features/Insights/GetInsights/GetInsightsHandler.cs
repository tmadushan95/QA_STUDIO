using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Features.Insights.GetInsights;

/// <summary>Handles <see cref="GetInsightsQuery"/>.</summary>
/// <param name="reader">The aggregate reader.</param>
/// <param name="clock">Clock.</param>
internal sealed class GetInsightsHandler(IInsightsReader reader, IClock clock) : IRequestHandler<GetInsightsQuery, InsightsData>
{
    private const int MaxDays = 365;

    public Task<InsightsData> HandleAsync(GetInsightsQuery request, CancellationToken cancellationToken)
    {
        var days = Math.Clamp(request.Days, 1, MaxDays);
        // Whole UTC days, so the first bar of the chart is never a partial day.
        var since = clock.UtcNow.Date.AddDays(1 - days);
        return reader.ReadAsync(since, request.ProjectId, request.VersionId, cancellationToken);
    }
}
