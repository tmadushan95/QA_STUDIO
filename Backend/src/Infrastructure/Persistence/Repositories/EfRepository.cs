using QaStudio.Application.Abstractions;
using QaStudio.Core.Common;

namespace QaStudio.Infrastructure.Persistence.Repositories;

/// <summary>What every aggregate's repository does alike.</summary>
/// <typeparam name="TEntity">The aggregate root.</typeparam>
/// <typeparam name="TId">Its key type.</typeparam>
/// <param name="context">The context.</param>
internal abstract class EfRepository<TEntity, TId>(QaStudioDbContext context) : IRepository<TEntity>
    where TEntity : AuditableEntity<TId>
    where TId : struct
{
    /// <summary>The context, for each repository's own reads.</summary>
    protected QaStudioDbContext Db { get; } = context;

    public void Add(TEntity entity) => Db.Set<TEntity>().Add(entity);

    public void Remove(TEntity entity) => Db.Set<TEntity>().Remove(entity);

    public void ExpectVersion(TEntity entity, byte[] rowVersion) =>
        Db.Entry(entity).Property(e => e.RowVersion).OriginalValue = rowVersion;
}
