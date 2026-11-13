using QaStudio.Core.Common;
using QaStudio.Core.TestCases;

namespace QaStudio.Core.Automation;

/// <summary>
/// One parameter value a test case sets for itself (read by its steps as <c>{{data.name}}</c>). There is deliberately no
/// foreign key to the test case, as for scenarios; deleting the case removes its values in the same transaction.
/// </summary>
public sealed class CaseParameterValue
{
    private CaseParameterValue()
    {
    }

    /// <summary>The test case ID.</summary>
    public string CaseCode { get; private set; } = string.Empty;

    /// <summary>The parameter name.</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>The value. Never empty: clearing a value removes the row.</summary>
    public string Value { get; private set; } = string.Empty;

    /// <summary>When the value was last saved (UTC).</summary>
    public DateTime UpdatedAtUtc { get; private set; }

    /// <summary>Creates a value.</summary>
    /// <param name="caseCode">The test case ID.</param>
    /// <param name="name">The parameter name.</param>
    /// <param name="value">The value.</param>
    /// <param name="atUtc">When it is saved.</param>
    /// <returns>The value.</returns>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public static CaseParameterValue Create(string caseCode, string name, string value, DateTime atUtc)
    {
        new DomainRules()
            .Required(FieldNames.Id, caseCode, "A parameter value needs a test case.")
            .MaxLength(FieldNames.Id, caseCode, TestCase.CodeMaxLength)
            .Required(FieldNames.Name, name, "A parameter needs a name.")
            .MaxLength(FieldNames.Name, name, ParameterLimits.NameMaxLength)
            .Required(FieldNames.Json, value, "A parameter value cannot be empty.")
            .MaxLength(FieldNames.Json, value, ParameterLimits.ValueMaxLength)
            .ThrowIfBroken();
        return new CaseParameterValue { CaseCode = caseCode, Name = name, Value = value, UpdatedAtUtc = atUtc };
    }

    /// <summary>Takes on a newer value of the same parameter.</summary>
    /// <param name="newer">The newer value.</param>
    public void ReplaceWith(CaseParameterValue newer)
    {
        ArgumentNullException.ThrowIfNull(newer);
        Value = newer.Value;
        UpdatedAtUtc = newer.UpdatedAtUtc;
    }
}
