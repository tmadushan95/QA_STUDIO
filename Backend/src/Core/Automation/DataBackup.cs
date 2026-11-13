using QaStudio.Core.Common;

namespace QaStudio.Core.Automation;

/// <summary>A snapshot taken before "clear all data", so the clear can be undone for a week.</summary>
public sealed class DataBackup
{
    private DataBackup()
    {
    }

    /// <summary>Backup ID.</summary>
    public string Id { get; private set; } = string.Empty;

    /// <summary>When it was taken (UTC).</summary>
    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>Why it was taken.</summary>
    public string Reason { get; private set; } = string.Empty;

    /// <summary>
    /// Which suite each case was filed under, as a JSON map of case ID to suite key. Kept apart from the snapshot because
    /// the snapshot is the worker's document and the worker knows nothing about suites. Null for older backups.
    /// </summary>
    public string? FilingJson { get; private set; }

    /// <summary>The snapshot as JSON.</summary>
    public string Json { get; private set; } = "{}";

    /// <summary>Creates a backup.</summary>
    /// <param name="id">Backup ID.</param>
    /// <param name="createdAtUtc">When it was taken.</param>
    /// <param name="reason">Why it was taken.</param>
    /// <param name="json">The snapshot.</param>
    /// <returns>The backup.</returns>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public static DataBackup Create(string id, DateTime createdAtUtc, string reason, string json)
    {
        new DomainRules()
            .Required(FieldNames.Id, id, "A backup needs an ID.")
            .MaxLength(FieldNames.Id, id, DocumentLimits.IdMaxLength)
            .MaxLength(FieldNames.Reason, reason, DocumentLimits.ReasonMaxLength)
            .Required(FieldNames.Json, json, "A backup needs a snapshot.")
            .ThrowIfBroken();
        return new DataBackup { Id = id, CreatedAtUtc = createdAtUtc, Reason = reason, Json = json };
    }

    /// <summary>Records where the cases were filed when this was taken.</summary>
    /// <param name="filingJson">Suite key by case ID, as JSON.</param>
    public void RecordFiling(string filingJson) => FilingJson = filingJson;

    /// <summary>Takes on a newer snapshot.</summary>
    /// <param name="newer">The newer snapshot.</param>
    public void ReplaceWith(DataBackup newer)
    {
        ArgumentNullException.ThrowIfNull(newer);
        Json = newer.Json;
    }
}
