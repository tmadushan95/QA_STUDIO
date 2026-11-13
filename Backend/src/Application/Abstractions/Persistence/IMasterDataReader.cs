namespace QaStudio.Application.Abstractions;

/// <summary>Reads the master data lists: projects, suites and versions. They rarely change, so reads are cached.</summary>
public interface IMasterDataReader
{
    /// <summary>Every project, by name.</summary>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The projects.</returns>
    Task<IReadOnlyList<ProjectItem>> ListProjectsAsync(CancellationToken cancellationToken);

    /// <summary>Every suite, in display order.</summary>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The suites.</returns>
    Task<IReadOnlyList<TestSuiteItem>> ListSuitesAsync(CancellationToken cancellationToken);

    /// <summary>Every project version, newest release first within each project.</summary>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The versions.</returns>
    Task<IReadOnlyList<ProjectVersionItem>> ListVersionsAsync(CancellationToken cancellationToken);
}
