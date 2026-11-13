using System.Text.RegularExpressions;
using QaStudio.Core.Automation;
using QaStudio.Core.Common;

namespace QaStudio.Application.Features.Parameters.Common;

/// <summary>What a saved set of parameter values must satisfy, and the trimmed set that is saved.</summary>
public static partial class ParameterRules
{
    /// <summary>The error code for a set with a bad name or value.</summary>
    public const string InvalidCode = "invalid-parameters";

    /// <summary>The error code for too many names.</summary>
    public const string TooManyCode = "too-many-parameters";

    /// <summary>
    /// Checks the values as typed and returns the ones to save: trimmed, with empty values dropped (so "clear the field" means
    /// "no value of my own").
    /// </summary>
    /// <param name="values">The values as sent.</param>
    /// <returns>The values to save.</returns>
    /// <exception cref="RequestValidationException">A name or value breaks the rules, or there are too many.</exception>
    public static Dictionary<string, string> Normalize(IReadOnlyDictionary<string, string?> values)
    {
        ArgumentNullException.ThrowIfNull(values);
        var problems = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (name, value) in values)
        {
            if (!NamePattern().IsMatch(name))
            {
                problems[$"values.{name}"] = "Use letters, digits, - or _, starting with a letter.";
            }
            else if ((value ?? string.Empty).Length > ParameterLimits.ValueMaxLength)
            {
                problems[$"values.{name}"] = $"Use {ParameterLimits.ValueMaxLength} characters or fewer.";
            }
        }

        if (problems.Count > 0)
        {
            throw new RequestValidationException(InvalidCode, "Some parameters could not be saved.", problems);
        }

        var kept = values
            .Select(p => (p.Key, Value: (p.Value ?? string.Empty).Trim()))
            .Where(p => p.Value.Length > 0)
            .ToDictionary(p => p.Key, p => p.Value, StringComparer.Ordinal);
        if (kept.Count > ParameterLimits.MaxPerCase)
        {
            throw new RequestValidationException(TooManyCode, $"At most {ParameterLimits.MaxPerCase} parameters can be saved at once.");
        }

        return kept;
    }

    [GeneratedRegex(@"^[A-Za-z][\w-]{0,99}$", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex NamePattern();
}
