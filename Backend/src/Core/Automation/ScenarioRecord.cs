using QaStudio.Core.Common;
using QaStudio.Core.TestCases;

namespace QaStudio.Core.Automation;

/// <summary>
/// The runnable steps of a test case, one row per slot. The body is a document owned by the execution worker, whose
/// step library defines and validates it, so it is stored as JSON. There is deliberately no foreign key to the test
/// case: a scenario outlives a deleted case until it is revoked, which is how the product already behaves.
/// </summary>
public sealed class ScenarioRecord
{
    private ScenarioRecord()
    {
    }

    /// <summary>The test case ID.</summary>
    public string CaseCode { get; private set; } = string.Empty;

    /// <summary>Draft or approved.</summary>
    public ScenarioSlot Slot { get; private set; }

    /// <summary>Version number, surfaced for reporting without parsing the JSON.</summary>
    public int Version { get; private set; }

    /// <summary>Lifecycle status, surfaced for reporting without parsing the JSON.</summary>
    public string Status { get; private set; } = string.Empty;

    /// <summary>The full scenario record as JSON.</summary>
    public string Json { get; private set; } = "{}";

    /// <summary>Creates a record.</summary>
    /// <param name="caseCode">The test case ID.</param>
    /// <param name="slot">Draft or approved.</param>
    /// <param name="version">Version number.</param>
    /// <param name="status">Lifecycle status.</param>
    /// <param name="json">The full record.</param>
    /// <returns>The record.</returns>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public static ScenarioRecord Create(string caseCode, ScenarioSlot slot, int version, string status, string json)
    {
        new DomainRules()
            .Required(FieldNames.Id, caseCode, "A scenario needs a test case ID.")
            .MaxLength(FieldNames.Id, caseCode, TestCase.CodeMaxLength)
            .MaxLength(FieldNames.Status, status, DocumentLimits.StatusMaxLength)
            .Required(FieldNames.Json, json, "A scenario needs a document.")
            .ThrowIfBroken();
        return new ScenarioRecord { CaseCode = caseCode, Slot = slot, Version = version, Status = status, Json = json };
    }

    /// <summary>Takes on a newer version of the same record.</summary>
    /// <param name="newer">The newer version.</param>
    public void ReplaceWith(ScenarioRecord newer)
    {
        ArgumentNullException.ThrowIfNull(newer);
        Version = newer.Version;
        Status = newer.Status;
        Json = newer.Json;
    }
}
