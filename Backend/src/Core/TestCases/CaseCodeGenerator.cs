using System.Globalization;
using System.Text.RegularExpressions;

namespace QaStudio.Core.TestCases;

/// <summary>
/// Picks the ID for a new test case. It follows the pattern most existing IDs use (prefix and number width), so
/// <c>TC_01 … TC_30</c> continues with <c>TC_31</c> and <c>ACE-0099</c> with <c>ACE-0100</c>.
/// </summary>
public static partial class CaseCodeGenerator
{
    /// <summary>Prefix used when there are no numbered IDs yet.</summary>
    public const string DefaultPrefix = "TC_";

    private const int DefaultWidth = 2;

    /// <summary>Returns the next free ID: the most common prefix, one above its highest number, padded alike.</summary>
    /// <param name="existing">Every ID in use.</param>
    /// <returns>An ID not in <paramref name="existing"/>.</returns>
    public static string Next(IEnumerable<string> existing)
    {
        var taken = new HashSet<string>(existing, StringComparer.Ordinal);
        var groups = new Dictionary<string, (int Count, long Max, int Width)>(StringComparer.Ordinal);
        foreach (var id in taken)
        {
            var match = Numbered().Match(id);
            // A digit run too long for a long is not an ordinal anyone counts up from.
            if (!match.Success || !long.TryParse(match.Groups[2].Value, CultureInfo.InvariantCulture, out var number))
            {
                continue;
            }

            var prefix = match.Groups[1].Value;
            var group = groups.GetValueOrDefault(prefix);
            groups[prefix] = (group.Count + 1, Math.Max(group.Max, number), Math.Max(group.Width, match.Groups[2].Length));
        }

        // The prefix most IDs share wins; a tie goes to the one with the highest number (the one in current use).
        var best = groups
            .OrderByDescending(g => g.Value.Count)
            .ThenByDescending(g => g.Value.Max)
            .Select(g => (Prefix: g.Key, g.Value.Max, g.Value.Width))
            .DefaultIfEmpty((Prefix: DefaultPrefix, Max: 0L, Width: DefaultWidth))
            .First();

        // Skip past any ID already used, for example one typed by hand with a gap in the numbers.
        var next = best.Max + 1;
        var candidate = Format(best.Prefix, next, best.Width);
        while (taken.Contains(candidate))
        {
            next++;
            candidate = Format(best.Prefix, next, best.Width);
        }

        return candidate;
    }

    private static string Format(string prefix, long number, int width) =>
        prefix + number.ToString(CultureInfo.InvariantCulture).PadLeft(width, '0');

    [GeneratedRegex(@"^(.*?)(\d+)$", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex Numbered();
}

