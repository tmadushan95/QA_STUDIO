using QaStudio.Application.Abstractions;

namespace QaStudio.Infrastructure.Persistence.Repositories;

/// <summary>Decorates the master data reader with the cache.</summary>
/// <param name="inner">The SQL reader.</param>
/// <param name="cache">The cache.</param>
internal sealed class CachedMasterDataReader(IMasterDataReader inner, MasterDataCache cache) : IMasterDataReader
{
    public Task<IReadOnlyList<ProjectItem>> ListProjectsAsync(CancellationToken cancellationToken) =>
        cache.ProjectsAsync(() => inner.ListProjectsAsync(cancellationToken));

    public Task<IReadOnlyList<TestSuiteItem>> ListSuitesAsync(CancellationToken cancellationToken) =>
        cache.SuitesAsync(() => inner.ListSuitesAsync(cancellationToken));

    public Task<IReadOnlyList<ProjectVersionItem>> ListVersionsAsync(CancellationToken cancellationToken) =>
        cache.VersionsAsync(() => inner.ListVersionsAsync(cancellationToken));
}
