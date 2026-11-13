using QaStudio.Core.Automation;

namespace QaStudio.Application.Abstractions;

/// <summary>Reads and writes the audit trail.</summary>
public interface IAuditRepository
{
    /// <summary>Queues an entry.</summary>
    /// <param name="action">What happened.</param>
    /// <param name="target">What it happened to.</param>
    /// <param name="detail">Readable description. Never pass secrets.</param>
    void Add(string action, string target, string detail);

    /// <summary>The newest entries, newest first.</summary>
    /// <param name="limit">How many.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The entries.</returns>
    Task<IReadOnlyList<AuditEntry>> ListAsync(int limit, CancellationToken cancellationToken);
}
