using System.Globalization;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;
using QaStudio.Application.Features.ProjectVersions.Common;
using QaStudio.Core.Common;
using QaStudio.Core.MasterData;

namespace QaStudio.Application.Features.ProjectVersions.UpdateProjectVersion;

/// <summary>Handles <see cref="UpdateProjectVersionCommand"/>.</summary>
/// <param name="versions">Version repository.</param>
/// <param name="responses">Builds responses.</param>
/// <param name="audit">Audit trail.</param>
/// <param name="commit">Commits and announces the change.</param>
/// <param name="clock">Clock.</param>
internal sealed class UpdateProjectVersionHandler(
    IProjectVersionRepository versions,
    ProjectVersionResponseBuilder responses,
    IAuditRepository audit,
    MasterDataCommit commit,
    IClock clock) : IRequestHandler<UpdateProjectVersionCommand, ProjectVersionResponse>
{
    public async Task<ProjectVersionResponse> HandleAsync(UpdateProjectVersionCommand request, CancellationToken cancellationToken)
    {
        var version = await versions.FindAsync(request.Id, cancellationToken).ConfigureAwait(false)
            ?? throw ProjectVersionErrors.NotFound();
        var name = Text.OrEmpty(request.Name);
        if (!string.Equals(version.Name, name, StringComparison.OrdinalIgnoreCase)
            && await versions.FindByNameAsync(version.ProjectId, name, cancellationToken).ConfigureAwait(false) is not null)
        {
            throw ProjectVersionErrors.DuplicateName(name, "This project");
        }

        var now = clock.UtcNow;
        versions.ExpectVersionIfGiven(version, request.RowVersion);
        version.Update(name, request.Description, request.ReleaseDate, request.IsCurrent, request.IsActive, now);
        if (version.IsCurrent)
        {
            await CurrentVersionPolicy.ClearOthersAsync(versions, version.ProjectId, version.Id, now, cancellationToken).ConfigureAwait(false);
        }

        audit.Add(AuditActions.VersionUpdate, version.Id.ToString(CultureInfo.InvariantCulture), $"Version \"{name}\" updated.");
        await commit.SaveAndAnnounceAsync(cancellationToken).ConfigureAwait(false);
        return await responses.BuildAsync(version.Id, cancellationToken).ConfigureAwait(false);
    }
}
