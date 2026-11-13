using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Features.Dashboard.GetDashboard;

/// <summary>Reads where testing stands: latest results, coverage, trend and failures.</summary>
/// <param name="ProjectId">Only this project, when given (the project the person is working in).</param>
/// <param name="VersionId">Only this version, when given.</param>
public sealed record GetDashboardQuery(int? ProjectId = null, int? VersionId = null) : IQuery<DashboardData>;
