using Microsoft.EntityFrameworkCore;
using QaStudio.Application.Abstractions;
using QaStudio.Core.Automation;

namespace QaStudio.Infrastructure.Persistence.Repositories;

/// <summary>EF Core audit trail.</summary>
/// <param name="db">The context.</param>
/// <param name="clock">Clock.</param>
/// <param name="client">Which client sent the request, so an assistant's change is marked "(via mcp)".</param>
internal sealed class AuditRepository(QaStudioDbContext db, IClock clock, IRequestClient client) : IAuditRepository
{
    public void Add(string action, string target, string detail) =>
        db.AuditLog.Add(AuditEntry.Record(clock.UtcNow, action, target, client.Name is { } name ? $"{detail} (via {name})" : detail));

    public async Task<IReadOnlyList<AuditEntry>> ListAsync(int limit, CancellationToken cancellationToken) =>
        await db.AuditLog.AsNoTracking().OrderByDescending(a => a.Id).Take(limit).ToListAsync(cancellationToken).ConfigureAwait(false);
}
