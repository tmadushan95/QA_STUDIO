using QaStudio.Core.Common;

namespace QaStudio.Core.Automation;

/// <summary>An audit trail entry. Never contains secrets. Written once and never changed.</summary>
public sealed class AuditEntry : Entity<long>
{
    private AuditEntry()
    {
    }

    /// <summary>When it happened (UTC).</summary>
    public DateTime AtUtc { get; private set; }

    /// <summary>What happened, such as <c>scenario.save</c>.</summary>
    public string Action { get; private set; } = string.Empty;

    /// <summary>What it happened to.</summary>
    public string Target { get; private set; } = string.Empty;

    /// <summary>A readable description.</summary>
    public string Detail { get; private set; } = string.Empty;

    /// <summary>Records something that happened.</summary>
    /// <param name="atUtc">When it happened.</param>
    /// <param name="action">What happened.</param>
    /// <param name="target">What it happened to.</param>
    /// <param name="detail">A readable description.</param>
    /// <returns>The entry.</returns>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public static AuditEntry Record(DateTime atUtc, string action, string target, string detail)
    {
        new DomainRules()
            .Required(FieldNames.Action, action, "An audit entry needs an action.")
            .MaxLength(FieldNames.Action, action, DocumentLimits.NameMaxLength)
            .MaxLength(FieldNames.Target, target, DocumentLimits.ReasonMaxLength)
            .ThrowIfBroken();
        return new AuditEntry { AtUtc = atUtc, Action = action, Target = target, Detail = detail };
    }
}
