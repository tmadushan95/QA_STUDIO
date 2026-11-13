namespace QaStudio.Application.Abstractions;

/// <summary>What every aggregate's repository does alike. Reads differ per aggregate, so they are on its own interface.</summary>
/// <typeparam name="TEntity">The aggregate root.</typeparam>
public interface IRepository<in TEntity>
    where TEntity : class
{
    /// <summary>Queues a new entity.</summary>
    /// <param name="entity">The entity.</param>
    void Add(TEntity entity);

    /// <summary>Queues an entity's removal.</summary>
    /// <param name="entity">The entity.</param>
    void Remove(TEntity entity);

    /// <summary>Checks a concurrency token against the row, so an edit based on stale data is refused.</summary>
    /// <param name="entity">The tracked entity.</param>
    /// <param name="rowVersion">The version the editor opened.</param>
    void ExpectVersion(TEntity entity, byte[] rowVersion);
}
