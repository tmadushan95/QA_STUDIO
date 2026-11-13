using QaStudio.Core.Common;
using QaStudio.Core.TestCases;

namespace QaStudio.Core.Automation;

/// <summary>An earlier approved version of a scenario, kept so any change can be reviewed and undone.</summary>
public sealed class ScenarioRevision
{
    private ScenarioRevision()
    {
    }

    /// <summary>The test case ID.</summary>
    public string CaseCode { get; private set; } = string.Empty;

    /// <summary>Version number.</summary>
    public int Version { get; private set; }

    /// <summary>The full scenario record as JSON.</summary>
    public string Json { get; private set; } = "{}";

    /// <summary>Creates a revision.</summary>
    /// <param name="caseCode">The test case ID.</param>
    /// <param name="version">Version number.</param>
    /// <param name="json">The full record.</param>
    /// <returns>The revision.</returns>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public static ScenarioRevision Create(string caseCode, int version, string json)
    {
        new DomainRules()
            .Required(FieldNames.Id, caseCode, "A revision needs a test case ID.")
            .MaxLength(FieldNames.Id, caseCode, TestCase.CodeMaxLength)
            .Required(FieldNames.Json, json, "A revision needs a document.")
            .ThrowIfBroken();
        return new ScenarioRevision { CaseCode = caseCode, Version = version, Json = json };
    }

    /// <summary>Takes on another copy of the same version.</summary>
    /// <param name="newer">The other copy.</param>
    public void ReplaceWith(ScenarioRevision newer)
    {
        ArgumentNullException.ThrowIfNull(newer);
        Json = newer.Json;
    }
}
