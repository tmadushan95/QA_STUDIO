using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;
using QaStudio.Core.Common;
using QaStudio.Core.MasterData;

namespace QaStudio.Application.Features.Projects.DeleteProject;

/// <summary>Handles <see cref="DeleteProjectCommand"/>.</summary>
/// <param name="projects">Project repository.</param>
/// <param name="audit">Audit trail.</param>
/// <param name="commit">Commits and announces the change.</param>
internal sealed class DeleteProjectHandler(
    IProjectRepository projects,
    IAuditRepository audit,
    MasterDataCommit commit) : IRequestHandler<DeleteProjectCommand, Unit>
{
    public async Task<Unit> HandleAsync(DeleteProjectCommand request, CancellationToken cancellationToken)
    {
        var project = await projects.FindAsync(request.Id, cancellationToken).ConfigureAwait(false)
            ?? throw ProjectErrors.NotFound();
        project.EnsureCanBeDeleted(
            await projects.CountSuitesAsync(project.Id, cancellationToken).ConfigureAwait(false),
            await projects.CountAccountsAsync(project.Id, cancellationToken).ConfigureAwait(false));
        projects.Remove(project);
        audit.Add(AuditActions.ProjectDelete, project.Code, $"Project \"{project.Name}\" deleted.");
        await commit.SaveAndAnnounceAsync(cancellationToken).ConfigureAwait(false);
        return Unit.Value;
    }
}
