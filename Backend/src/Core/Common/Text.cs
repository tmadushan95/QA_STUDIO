namespace QaStudio.Core.Common;

/// <summary>How optional text is stored and how counts are worded, in one place.</summary>
public static class Text
{
    /// <summary>Normalizes optional text to its stored form.</summary>
    /// <param name="value">The text.</param>
    /// <returns>Trimmed text; null rather than blank.</returns>
    public static string? OrNull(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>Normalizes required text, leaving it to the entity's rules to refuse a blank.</summary>
    /// <param name="value">The text.</param>
    /// <returns>Trimmed text; empty rather than null.</returns>
    public static string OrEmpty(string? value) => value?.Trim() ?? string.Empty;

    /// <summary>Words a count, such as "1 test suite" or "2 test suites".</summary>
    /// <param name="count">The count.</param>
    /// <param name="noun">The singular noun.</param>
    /// <returns>The wording.</returns>
    public static string Count(int count, string noun) => $"{count} {noun}{(count == 1 ? string.Empty : "s")}";
}
