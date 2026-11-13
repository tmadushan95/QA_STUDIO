using QaStudio.Core.Common;

namespace QaStudio.Core.Automation;

/// <summary>An AI provider key. Ciphertext only.</summary>
public sealed class AiProviderKey
{
    private AiProviderKey()
    {
    }

    /// <summary>Provider name.</summary>
    public string Provider { get; private set; } = string.Empty;

    /// <summary>Encrypted key.</summary>
    public string KeyEnc { get; private set; } = string.Empty;

    /// <summary>When it was saved, ISO-8601.</summary>
    public string UpdatedAt { get; private set; } = string.Empty;

    /// <summary>Creates a key.</summary>
    /// <param name="provider">Provider name.</param>
    /// <param name="keyEnc">Encrypted key.</param>
    /// <param name="updatedAt">When it was saved.</param>
    /// <returns>The key.</returns>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public static AiProviderKey Create(string provider, string keyEnc, string updatedAt)
    {
        new DomainRules()
            .Required(FieldNames.Key, provider, "A key needs a provider.")
            .MaxLength(FieldNames.Key, provider, DocumentLimits.NameMaxLength)
            .Required(FieldNames.Secret, keyEnc, "A key cannot be empty.")
            .ThrowIfBroken();
        return new AiProviderKey { Provider = provider, KeyEnc = keyEnc, UpdatedAt = updatedAt };
    }

    /// <summary>Takes on a newer key.</summary>
    /// <param name="newer">The newer key.</param>
    public void ReplaceWith(AiProviderKey newer)
    {
        ArgumentNullException.ThrowIfNull(newer);
        KeyEnc = newer.KeyEnc;
        UpdatedAt = newer.UpdatedAt;
    }
}
