using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.Common;
using QaStudio.Core.Common;

namespace QaStudio.Application.Features.Parameters.AutoConfigureParameters;

/// <summary>Handles <see cref="AutoConfigureParametersCommand"/>.</summary>
/// <param name="cases">Reads which cases exist.</param>
/// <param name="reads">Reads each case's view.</param>
/// <param name="suggester">Suggests the values.</param>
/// <param name="store">The parameter values.</param>
/// <param name="audit">The audit trail.</param>
/// <param name="unitOfWork">Commits the change.</param>
/// <param name="clock">Clock.</param>
internal sealed class AutoConfigureParametersHandler(
    IParameterCaseReader cases,
    ParameterReads reads,
    ParameterSuggester suggester,
    IParameterStore store,
    IAuditRepository audit,
    IUnitOfWork unitOfWork,
    IClock clock) : IRequestHandler<AutoConfigureParametersCommand, AutoConfigureResult>
{
    private const int MaxCases = 5000;

    public async Task<AutoConfigureResult> HandleAsync(AutoConfigureParametersCommand request, CancellationToken cancellationToken)
    {
        var ids = request.CaseIds.Where(id => !string.IsNullOrEmpty(id)).Distinct(StringComparer.Ordinal).ToList();
        if (ids.Count == 0 || request.CaseIds.Count > MaxCases)
        {
            throw new RequestValidationException(ErrorCodes.InvalidRequest, "Choose the test cases to configure.");
        }

        var known = await cases.ReadProjectsAsync(ids, cancellationToken).ConfigureAwait(false);
        var configured = 0;
        var filled = 0;
        var stillMissing = new List<ParameterSummaryRow>();
        foreach (var id in ids.Where(known.ContainsKey))
        {
            var view = await reads.CaseAsync(id, cancellationToken).ConfigureAwait(false);
            var suggestions = await suggester.ForMissingAsync(id, view.Missing, request.UseAi, cancellationToken).ConfigureAwait(false);
            if (suggestions.Count > 0)
            {
                // Only missing names were suggested, so a value a person set is never touched.
                var merged = (await store.GetCaseAsync(id, cancellationToken).ConfigureAwait(false)).ToDictionary(p => p.Key, p => p.Value, StringComparer.Ordinal);
                foreach (var s in suggestions)
                {
                    merged[s.Name] = s.Value;
                }

                await store.ReplaceCaseAsync(id, merged, clock.UtcNow, cancellationToken).ConfigureAwait(false);
                configured++;
                filled += suggestions.Count;
            }

            var left = view.Missing.Except(suggestions.Select(s => s.Name), StringComparer.Ordinal).ToList();
            if (left.Count > 0)
            {
                stillMissing.Add(new ParameterSummaryRow(id, view.Items.Count(i => i.Used), left));
            }
        }

        audit.Add(AuditActions.ParametersAuto, "test cases", $"Filled {filled} values in {configured} test cases automatically.");
        await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return new AutoConfigureResult(configured, filled, stillMissing);
    }
}
