using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Features.Dashboard.GetDashboard;

/// <summary>Handles <see cref="GetDashboardQuery"/>.</summary>
/// <param name="reader">Reads the cases, runs and approved scenarios.</param>
internal sealed class GetDashboardHandler(IDashboardReader reader) : IRequestHandler<GetDashboardQuery, DashboardData>
{
    public async Task<DashboardData> HandleAsync(GetDashboardQuery request, CancellationToken cancellationToken)
    {
        var input = await reader.ReadAsync(request.ProjectId, request.VersionId, cancellationToken).ConfigureAwait(false);
        return DashboardBuilder.Build(input);
    }
}
