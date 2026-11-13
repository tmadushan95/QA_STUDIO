using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;
using QaStudio.Application.Features.ProjectVersions.Common;
using QaStudio.Core.Common;
using QaStudio.Core.MasterData;

namespace QaStudio.Application.Features.ProjectVersions.CreateProjectVersion;

/// <summary>Handles <see cref="CreateProjectVersionCommand"/>.</summary>
/// <param name="projects">Project repository.</param>
/// <param name="versions">Version repository.</param>
/// <param name="responses">Builds responses.</param>
/// <param name="audit">Audit trail.</param>
/// <param name="commit">Commits and announces the change.</param>
/// <param name="clock">Clock.</param>
internal sealed class CreateProjectVersionHandler(
    IProjectRepository projects,
    IProjectVersionRepository versions,
    ProjectVersionResponseBuilder responses,
    IAuditRepository audit,
    MasterDataCommit commit,
    IClock clock) : IRequestHandler<CreateProjectVersionCommand, ProjectVersionResponse>
{
    public async Task<ProjectVersionResponse> HandleAsync(CreateProjectVersionCommand request, CancellationToken cancellationToken)
    {
        var project = await projects.FindAsync(request.ProjectId, cancellationToken).ConfigureAwait(false)
            ?? throw ProjectErrors.NotFound();
        var now = clock.UtcNow;
        var version = ProjectVersion.Create(project.Id, request.Name, request.Description, request.ReleaseDate, request.IsCurrent, now);
        if (await versions.FindByNameAsync(project.Id, version.Name, cancellationToken).ConfigureAwait(false) is not null)
        {
            throw ProjectVersionErrors.DuplicateName(version.Name, project.Name);
        }

        if (version.IsCurrent)
        {
            await CurrentVersionPolicy.ClearOthersAsync(versions, project.Id, 0, now, cancellationToken).ConfigureAwait(false);
        }

        versions.Add(version);
        audit.Add(AuditActions.VersionCreate, project.Code, $"Version \"{version.Name}\" created.");
        await commit.SaveAndAnnounceAsync(cancellationToken).ConfigureAwait(false);
        return await responses.BuildAsync(version.Id, cancellationToken).ConfigureAwait(false);
    }
}
