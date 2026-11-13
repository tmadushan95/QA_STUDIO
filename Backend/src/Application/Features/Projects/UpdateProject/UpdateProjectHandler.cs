using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;
using QaStudio.Application.Features.Projects.Common;
using QaStudio.Core.Common;
using QaStudio.Core.MasterData;

namespace QaStudio.Application.Features.Projects.UpdateProject;

/// <summary>Handles <see cref="UpdateProjectCommand"/>.</summary>
/// <param name="projects">Project repository.</param>
/// <param name="responses">Builds responses.</param>
/// <param name="audit">Audit trail.</param>
/// <param name="commit">Commits and announces the change.</param>
/// <param name="clock">Clock.</param>
internal sealed class UpdateProjectHandler(
    IProjectRepository projects,
    ProjectResponseBuilder responses,
    IAuditRepository audit,
    MasterDataCommit commit,
    IClock clock) : IRequestHandler<UpdateProjectCommand, ProjectResponse>
{
    public async Task<ProjectResponse> HandleAsync(UpdateProjectCommand request, CancellationToken cancellationToken)
    {
        var project = await projects.FindAsync(request.Id, cancellationToken).ConfigureAwait(false)
            ?? throw ProjectErrors.NotFound();
        var code = Project.NormalizeCode(request.Code);
        if (!string.Equals(project.Code, code, StringComparison.Ordinal)
            && await projects.FindByCodeAsync(code, cancellationToken).ConfigureAwait(false) is not null)
        {
            throw ProjectErrors.DuplicateCode(code);
        }

        projects.ExpectVersionIfGiven(project, request.RowVersion);
        project.Update(code, request.Name, request.Description, request.IsActive, clock.UtcNow);
        audit.Add(AuditActions.ProjectUpdate, project.Code, $"Project \"{project.Name}\" updated.");
        await commit.SaveAndAnnounceAsync(cancellationToken).ConfigureAwait(false);
        return await responses.BuildAsync(project.Id, cancellationToken).ConfigureAwait(false);
    }
}
