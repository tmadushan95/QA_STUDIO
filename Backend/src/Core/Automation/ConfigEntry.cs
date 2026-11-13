using QaStudio.Core.Common;

namespace QaStudio.Core.Automation;

/// <summary>A named block of non-secret configuration, such as app settings and the AI provider choice.</summary>
public sealed class ConfigEntry
{
    private ConfigEntry()
    {
    }

    /// <summary>Configuration name.</summary>
    public string Key { get; private set; } = string.Empty;

    /// <summary>The value as JSON.</summary>
    public string Json { get; private set; } = "null";

    /// <summary>Creates a block.</summary>
    /// <param name="key">Configuration name.</param>
    /// <param name="json">The value.</param>
    /// <returns>The block.</returns>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public static ConfigEntry Create(string key, string json)
    {
        new DomainRules()
            .Required(FieldNames.Key, key, "A configuration block needs a name.")
            .MaxLength(FieldNames.Key, key, DocumentLimits.NameMaxLength)
            .ThrowIfBroken();
        return new ConfigEntry { Key = key, Json = json };
    }

    /// <summary>Takes on a newer value.</summary>
    /// <param name="newer">The newer value.</param>
    public void ReplaceWith(ConfigEntry newer)
    {
        ArgumentNullException.ThrowIfNull(newer);
        Json = newer.Json;
    }
}
