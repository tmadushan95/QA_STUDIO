using Microsoft.EntityFrameworkCore;
using QaStudio.Application.Abstractions;
using QaStudio.Core.Automation;

namespace QaStudio.Infrastructure.Persistence.Repositories;

/// <summary>EF Core store for configuration blocks.</summary>
/// <param name="db">The context.</param>
internal sealed class ConfigStore(QaStudioDbContext db) : IConfigStore
{
    public async Task<string?> GetJsonAsync(string key, CancellationToken cancellationToken) =>
        (await db.ConfigEntries.AsNoTracking().FirstOrDefaultAsync(c => c.Key == key, cancellationToken).ConfigureAwait(false))?.Json;

    public async Task<IReadOnlyDictionary<string, string>> GetByPrefixAsync(string prefix, CancellationToken cancellationToken)
    {
        var nested = prefix + ":";
        var rows = await db.ConfigEntries.AsNoTracking()
            .Where(c => c.Key == prefix || c.Key.StartsWith(nested))
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        return rows.ToDictionary(r => r.Key, r => r.Json, StringComparer.Ordinal);
    }

    public async Task SaveJsonAsync(string key, string json, CancellationToken cancellationToken)
    {
        var entry = ConfigEntry.Create(key, json);
        var row = await db.ConfigEntries.FindAsync([key], cancellationToken).ConfigureAwait(false);
        if (row is null)
        {
            db.ConfigEntries.Add(entry);
        }
        else
        {
            row.ReplaceWith(entry);
        }
    }
}
