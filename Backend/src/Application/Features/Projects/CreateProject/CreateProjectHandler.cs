using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;
using QaStudio.Application.Features.Projects.Common;
using QaStudio.Core.Common;
using QaStudio.Core.MasterData;

namespace QaStudio.Application.Features.Projects.CreateProject;

/// <summary>Handles <see cref="CreateProjectCommand"/>.</summary>
/// <param name="projects">Project repository.</param>
/// <param name="responses">Builds responses.</param>
/// <param name="audit">Audit trail.</param>
/// <param name="commit">Commits and announces the change.</param>
/// <param name="clock">Clock.</param>
internal sealed class CreateProjectHandler(
    IProjectRepository projects,
    ProjectResponseBuilder responses,
    IAuditRepository audit,
    MasterDataCommit commit,
    IClock clock) : IRequestHandler<CreateProjectCommand, ProjectResponse>
{
    public async Task<ProjectResponse> HandleAsync(CreateProjectCommand request, CancellationToken cancellationToken)
    {
        var project = Project.Create(request.Code, request.Name, request.Description, clock.UtcNow);
        if (await projects.FindByCodeAsync(project.Code, cancellationToken).ConfigureAwait(false) is not null)
        {
            throw ProjectErrors.DuplicateCode(project.Code);
        }

        projects.Add(project);
        audit.Add(AuditActions.ProjectCreate, project.Code, $"Project \"{project.Name}\" created.");
        await commit.SaveAndAnnounceAsync(cancellationToken).ConfigureAwait(false);
        return await responses.BuildAsync(project.Id, cancellationToken).ConfigureAwait(false);
    }
}
