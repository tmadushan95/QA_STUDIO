using QaStudio.Core.MasterData;

namespace QaStudio.Application.Abstractions;

/// <summary>Repository for test suites.</summary>
public interface ITestSuiteRepository : IRepository<TestSuite>
{
    /// <summary>Gets a suite for changing.</summary>
    /// <param name="id">The key.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The suite, or null.</returns>
    Task<TestSuite?> FindAsync(int id, CancellationToken cancellationToken);

    /// <summary>Gets a suite by name within a project.</summary>
    /// <param name="projectId">The project's key.</param>
    /// <param name="name">The suite name.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The suite, or null.</returns>
    Task<TestSuite?> FindByNameAsync(int projectId, string name, CancellationToken cancellationToken);
}
