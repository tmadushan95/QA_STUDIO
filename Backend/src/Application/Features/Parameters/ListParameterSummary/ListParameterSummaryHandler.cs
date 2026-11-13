using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.Common;

namespace QaStudio.Application.Features.Parameters.ListParameterSummary;

/// <summary>Handles <see cref="ListParameterSummaryQuery"/>.</summary>
/// <param name="cases">Reads the cases and their steps.</param>
/// <param name="store">The parameter values.</param>
internal sealed class ListParameterSummaryHandler(IParameterCaseReader cases, IParameterStore store) : IRequestHandler<ListParameterSummaryQuery, IReadOnlyList<ParameterSummaryRow>>
{
    public async Task<IReadOnlyList<ParameterSummaryRow>> HandleAsync(ListParameterSummaryQuery request, CancellationToken cancellationToken)
    {
        var all = await cases.ReadAsync(null, null, cancellationToken).ConfigureAwait(false);
        var own = await store.GetCasesAsync(null, cancellationToken).ConfigureAwait(false);
        var common = await store.GetProjectsAsync(null, cancellationToken).ConfigureAwait(false);
        return ParameterViews.Summary(all.Select(c => (c.Code, c.ProjectId, ParameterViews.NeededNames(c.ScenarioJson))), own, common);
    }
}
