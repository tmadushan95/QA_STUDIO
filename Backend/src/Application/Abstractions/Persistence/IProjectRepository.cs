using QaStudio.Core.MasterData;

namespace QaStudio.Application.Abstractions;

/// <summary>Repository for projects.</summary>
public interface IProjectRepository : IRepository<Project>
{
    /// <summary>Gets a project for changing.</summary>
    /// <param name="id">The key.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The project, or null.</returns>
    Task<Project?> FindAsync(int id, CancellationToken cancellationToken);

    /// <summary>Gets a project by code for changing.</summary>
    /// <param name="code">The code.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The project, or null.</returns>
    Task<Project?> FindByCodeAsync(string code, CancellationToken cancellationToken);

    /// <summary>Counts a project's suites.</summary>
    /// <param name="id">The project's key.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>How many suites it has.</returns>
    Task<int> CountSuitesAsync(int id, CancellationToken cancellationToken);

    /// <summary>Counts a project's test accounts.</summary>
    /// <param name="id">The project's key.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>How many test accounts it has.</returns>
    Task<int> CountAccountsAsync(int id, CancellationToken cancellationToken);
}
