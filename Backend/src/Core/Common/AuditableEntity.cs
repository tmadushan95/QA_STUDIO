namespace QaStudio.Core.Common;

/// <summary>Base for aggregate roots: creation and change times, plus the optimistic-concurrency token.</summary>
/// <typeparam name="TId">The key type.</typeparam>
public abstract class AuditableEntity<TId> : Entity<TId>
    where TId : struct
{
    /// <summary>When the row was created (UTC).</summary>
    public DateTime CreatedAtUtc { get; protected set; }

    /// <summary>When the row last changed (UTC).</summary>
    public DateTime UpdatedAtUtc { get; protected set; }

    /// <summary>SQL Server rowversion; a stale value makes an update fail instead of overwriting someone's edit.</summary>
    public byte[] RowVersion { get; protected set; } = [];

    /// <summary>Stamps the row as changed.</summary>
    /// <param name="utcNow">The current UTC time.</param>
    protected void Touch(DateTime utcNow) => UpdatedAtUtc = utcNow;
}
