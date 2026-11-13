using System.Globalization;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;
using QaStudio.Core.Common;
using QaStudio.Core.MasterData;

namespace QaStudio.Application.Features.ProjectVersions.DeleteProjectVersion;

/// <summary>
/// Handles <see cref="DeleteProjectVersionCommand"/>. Unlike a suite, a version is only a label on its cases, so
/// deleting it never deletes a case: the database clears the label (ON DELETE SET NULL).
/// </summary>
/// <param name="versions">Version repository.</param>
/// <param name="audit">Audit trail.</param>
/// <param name="commit">Commits and announces the change.</param>
internal sealed class DeleteProjectVersionHandler(
    IProjectVersionRepository versions,
    IAuditRepository audit,
    MasterDataCommit commit) : IRequestHandler<DeleteProjectVersionCommand, Unit>
{
    public async Task<Unit> HandleAsync(DeleteProjectVersionCommand request, CancellationToken cancellationToken)
    {
        var version = await versions.FindAsync(request.Id, cancellationToken).ConfigureAwait(false)
            ?? throw ProjectVersionErrors.NotFound();
        versions.Remove(version);
        audit.Add(AuditActions.VersionDelete, version.Id.ToString(CultureInfo.InvariantCulture), $"Version \"{version.Name}\" deleted.");
        await commit.SaveAndAnnounceAsync(cancellationToken).ConfigureAwait(false);
        return Unit.Value;
    }
}
