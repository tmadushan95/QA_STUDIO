using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.Common;
using QaStudio.Core.Common;
using QaStudio.Core.MasterData;

namespace QaStudio.Application.Features.Parameters.UpdateCommonParameters;

/// <summary>Handles <see cref="UpdateCommonParametersCommand"/>.</summary>
/// <param name="projects">Projects, to check it exists.</param>
/// <param name="store">The parameter values.</param>
/// <param name="reads">Reads the view that is returned.</param>
/// <param name="audit">The audit trail.</param>
/// <param name="unitOfWork">Commits the change.</param>
/// <param name="clock">Clock.</param>
internal sealed class UpdateCommonParametersHandler(
    IProjectRepository projects,
    IParameterStore store,
    ParameterReads reads,
    IAuditRepository audit,
    IUnitOfWork unitOfWork,
    IClock clock) : IRequestHandler<UpdateCommonParametersCommand, CommonParameters>
{
    public async Task<CommonParameters> HandleAsync(UpdateCommonParametersCommand request, CancellationToken cancellationToken)
    {
        if (await projects.FindAsync(request.ProjectId, cancellationToken).ConfigureAwait(false) is null)
        {
            throw ProjectErrors.NotFound();
        }

        var kept = ParameterRules.Normalize(request.Values);
        await store.ReplaceProjectAsync(request.ProjectId, kept, clock.UtcNow, cancellationToken).ConfigureAwait(false);
        audit.Add(AuditActions.ParametersCommon, $"project {request.ProjectId}", $"Saved {kept.Count} common parameters.");
        await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return await reads.ProjectAsync(request.ProjectId, cancellationToken).ConfigureAwait(false);
    }
}
