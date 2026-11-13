using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using QaStudio.Application.Abstractions;

namespace QaStudio.Infrastructure.Persistence.Repositories;

/// <summary>
/// The in-memory master data lists. Writers invalidate on commit; the expiry covers a second API instance, or a
/// change made directly in SQL, neither of which this process can see.
/// </summary>
/// <param name="cache">The memory cache.</param>
/// <param name="options">Database settings, for the expiry.</param>
internal sealed class MasterDataCache(IMemoryCache cache, IOptions<DatabaseOptions> options) : IMasterDataCacheInvalidator
{
    private const string ProjectsKey = "master-data:projects";
    private const string SuitesKey = "master-data:suites";
    private const string VersionsKey = "master-data:versions";

    /// <summary>Gets the projects, loading them when not cached.</summary>
    /// <param name="load">Loads from SQL Server.</param>
    /// <returns>The projects.</returns>
    public Task<IReadOnlyList<ProjectItem>> ProjectsAsync(Func<Task<IReadOnlyList<ProjectItem>>> load) =>
        GetAsync(ProjectsKey, load);

    /// <summary>Gets the suites, loading them when not cached.</summary>
    /// <param name="load">Loads from SQL Server.</param>
    /// <returns>The suites.</returns>
    public Task<IReadOnlyList<TestSuiteItem>> SuitesAsync(Func<Task<IReadOnlyList<TestSuiteItem>>> load) =>
        GetAsync(SuitesKey, load);

    /// <summary>Gets the project versions, loading them when not cached.</summary>
    /// <param name="load">Loads from SQL Server.</param>
    /// <returns>The versions.</returns>
    public Task<IReadOnlyList<ProjectVersionItem>> VersionsAsync(Func<Task<IReadOnlyList<ProjectVersionItem>>> load) =>
        GetAsync(VersionsKey, load);

    public void Invalidate()
    {
        cache.Remove(ProjectsKey);
        cache.Remove(SuitesKey);
        cache.Remove(VersionsKey);
    }

    private async Task<T> GetAsync<T>(string key, Func<Task<T>> load)
    {
        if (cache.TryGetValue(key, out T? cached) && cached is not null)
        {
            return cached;
        }

        var value = await load().ConfigureAwait(false);
        cache.Set(key, value, TimeSpan.FromMinutes(options.Value.MasterDataCacheMinutes));
        return value;
    }
}
