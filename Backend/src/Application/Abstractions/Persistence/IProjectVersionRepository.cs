using QaStudio.Core.MasterData;

namespace QaStudio.Application.Abstractions;

/// <summary>Repository for project versions.</summary>
public interface IProjectVersionRepository : IRepository<ProjectVersion>
{
    /// <summary>Gets a version for changing.</summary>
    /// <param name="id">The key.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The version, or null.</returns>
    Task<ProjectVersion?> FindAsync(int id, CancellationToken cancellationToken);

    /// <summary>Gets a version by name within a project.</summary>
    /// <param name="projectId">The project's key.</param>
    /// <param name="name">The version name.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The version, or null.</returns>
    Task<ProjectVersion?> FindByNameAsync(int projectId, string name, CancellationToken cancellationToken);

    /// <summary>Gets the project's versions marked current, for changing.</summary>
    /// <param name="projectId">The project's key.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The versions; normally zero or one.</returns>
    Task<IReadOnlyList<ProjectVersion>> FindCurrentAsync(int projectId, CancellationToken cancellationToken);
}
