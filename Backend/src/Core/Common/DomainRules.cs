namespace QaStudio.Core.Common;

/// <summary>
/// Collects every broken rule of an entity before refusing it, so a form can show all its mistakes at once rather than
/// one per save. The first failure per field is the one worth showing, so later ones for that field are ignored.
/// </summary>
public sealed class DomainRules
{
    private readonly Dictionary<string, string> _failures = new(StringComparer.Ordinal);

    /// <summary>Requires text that is not blank.</summary>
    /// <param name="field">The field.</param>
    /// <param name="value">The text.</param>
    /// <param name="message">What to tell the person.</param>
    /// <returns>This instance.</returns>
    public DomainRules Required(string field, string? value, string message) =>
        That(field, !string.IsNullOrWhiteSpace(value), message);

    /// <summary>Limits text to what its column can hold.</summary>
    /// <param name="field">The field.</param>
    /// <param name="value">The text, if any.</param>
    /// <param name="maxLength">The longest allowed.</param>
    /// <returns>This instance.</returns>
    public DomainRules MaxLength(string field, string? value, int maxLength) =>
        That(field, value is null || value.Length <= maxLength, $"Use {maxLength} characters or fewer.");

    /// <summary>Requires a condition.</summary>
    /// <param name="field">The field.</param>
    /// <param name="condition">Whether the rule holds.</param>
    /// <param name="message">What to tell the person.</param>
    /// <returns>This instance.</returns>
    public DomainRules That(string field, bool condition, string message)
    {
        if (!condition)
        {
            _failures.TryAdd(field, message);
        }

        return this;
    }

    /// <summary>Refuses the entity if any rule was broken.</summary>
    /// <exception cref="DomainValidationException">At least one rule was broken.</exception>
    public void ThrowIfBroken()
    {
        if (_failures.Count > 0)
        {
            throw new DomainValidationException(_failures);
        }
    }
}
