using System.Globalization;
using System.Text.RegularExpressions;

namespace QaStudio.Application.Features.Parameters.Common;

/// <summary>
/// A safe, realistic value from a parameter's name alone, used when there is no earlier value and no AI. It never guesses
/// anything secret: a name that looks like a password gets no value, so the case stays blocked until a person decides.
/// </summary>
public static partial class ParameterGuess
{
    /// <summary>Guesses a value for a name.</summary>
    /// <param name="name">The parameter name.</param>
    /// <param name="now">The current time, for dates and unique-looking stamps.</param>
    /// <returns>A value, or null when the name looks like a secret.</returns>
    public static string? Of(string name, DateTime now)
    {
        ArgumentNullException.ThrowIfNull(name);
        var n = name.ToLowerInvariant();
        var day = now.ToUniversalTime().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var stamp = day.Replace("-", string.Empty, StringComparison.Ordinal);
        if (Secret().IsMatch(n))
        {
            return null;
        }

        return n switch
        {
            _ when n.Contains("email", StringComparison.Ordinal) || n.Contains("mail", StringComparison.Ordinal) => $"qa.{stamp}@example.com",
            _ when n.Contains("date", StringComparison.Ordinal) || n.EndsWith("day", StringComparison.Ordinal) => day,
            _ when n.Contains("year", StringComparison.Ordinal) => now.ToUniversalTime().Year.ToString(CultureInfo.InvariantCulture),
            _ when n.Contains("phone", StringComparison.Ordinal) || n.Contains("mobile", StringComparison.Ordinal) => "+15555550100",
            _ when n.Contains("url", StringComparison.Ordinal) || n.Contains("link", StringComparison.Ordinal) || n.Contains("website", StringComparison.Ordinal) => "https://example.com",
            _ when Amount().IsMatch(n) => "100",
            _ when Identifier().IsMatch(n) => $"QA-{stamp}",
            _ when Text().IsMatch(n) => $"QA {TitleCase(name)} {stamp}",
            _ => $"QA {TitleCase(name)}",
        };
    }

    /// <summary>"owner_email" and "ownerEmail" as "Owner Email".</summary>
    /// <param name="name">The parameter name.</param>
    /// <returns>The words, capitalised.</returns>
    private static string TitleCase(string name)
    {
        var spaced = Separators().Replace(name, " ");
        spaced = CamelBoundary().Replace(spaced, "$1 $2");
        return WordStart().Replace(spaced, m => m.Value.ToUpperInvariant()).Trim();
    }

    [GeneratedRegex(@"pass(word)?|secret|token|api.?key|pin\b", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex Secret();

    [GeneratedRegex("(amount|price|cost|budget|qty|quantity|count|number|num|total)", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex Amount();

    [GeneratedRegex("(code|id|ref|key)$", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex Identifier();

    [GeneratedRegex("(name|title|label|description|comment|note)", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex Text();

    [GeneratedRegex("[_-]+", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex Separators();

    [GeneratedRegex("([a-z])([A-Z])", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex CamelBoundary();

    [GeneratedRegex(@"\b\w", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex WordStart();
}
