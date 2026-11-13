namespace QaStudio.Core.Common;

/// <summary>Base of every entity with a surrogate key: identity is the key, set by the database.</summary>
/// <typeparam name="TId">The key type.</typeparam>
public abstract class Entity<TId>
    where TId : struct
{
    /// <summary>Surrogate key.</summary>
    public TId Id { get; protected set; }
}
