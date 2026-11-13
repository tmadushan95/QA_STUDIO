using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.Common;
using QaStudio.Core.Common;

namespace QaStudio.Application.Features.Parameters.UpdateCaseParameters;

/// <summary>Handles <see cref="UpdateCaseParametersCommand"/>.</summary>
/// <param name="cases">Reads the case.</param>
/// <param name="store">The parameter values.</param>
/// <param name="reads">Reads the view that is returned.</param>
/// <param name="audit">The audit trail.</param>
/// <param name="unitOfWork">Commits the change.</param>
/// <param name="clock">Clock.</param>
internal sealed class UpdateCaseParametersHandler(
    IParameterCaseReader cases,
    IParameterStore store,
    ParameterReads reads,
    IAuditRepository audit,
    IUnitOfWork unitOfWork,
    IClock clock) : IRequestHandler<UpdateCaseParametersCommand, CaseParameters>
{
    public async Task<CaseParameters> HandleAsync(UpdateCaseParametersCommand request, CancellationToken cancellationToken)
    {
        if ((await cases.ReadProjectsAsync([request.CaseCode], cancellationToken).ConfigureAwait(false)).Count == 0)
        {
            throw ParameterReads.UnknownCase(request.CaseCode);
        }

        var kept = ParameterRules.Normalize(request.Values);
        await store.ReplaceCaseAsync(request.CaseCode, kept, clock.UtcNow, cancellationToken).ConfigureAwait(false);
        audit.Add(AuditActions.ParametersUpdate, request.CaseCode, $"Saved {kept.Count} parameters.");
        await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return await reads.CaseAsync(request.CaseCode, cancellationToken).ConfigureAwait(false);
    }
}
