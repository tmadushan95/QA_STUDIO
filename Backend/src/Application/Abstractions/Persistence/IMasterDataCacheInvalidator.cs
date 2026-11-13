namespace QaStudio.Application.Abstractions;

/// <summary>Drops cached master data. Called after anything that changes projects or suites has committed.</summary>
public interface IMasterDataCacheInvalidator
{
    /// <summary>Drops the cache.</summary>
    void Invalidate();
}
