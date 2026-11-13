using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Features.ProjectVersions.Common;

/// <summary>Keeps "at most one current version per project" true when a version becomes current.</summary>
internal static class CurrentVersionPolicy
{
    /// <summary>Clears the current flag on the project's other versions.</summary>
    /// <param name="versions">The repository.</param>
    /// <param name="projectId">The project's key.</param>
    /// <param name="keepId">The version that stays current (0 for one not saved yet).</param>
    /// <param name="utcNow">The current UTC time.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when the others are cleared.</returns>
    public static async Task ClearOthersAsync(
        IProjectVersionRepository versions,
        int projectId,
        int keepId,
        DateTime utcNow,
        CancellationToken cancellationToken)
    {
        foreach (var other in await versions.FindCurrentAsync(projectId, cancellationToken).ConfigureAwait(false))
        {
            if (other.Id != keepId)
            {
                other.ClearCurrent(utcNow);
            }
        }
    }
}
