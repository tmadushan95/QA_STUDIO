using System.Text.Json;
using System.Text.RegularExpressions;

namespace QaStudio.Application.Features.Pages.Common;

/// <summary>One page of the application under test: the name steps use, its address, and text that shows it has loaded.</summary>
/// <param name="Name">The name testers use in steps, such as "Draft projects".</param>
/// <param name="Route">The path on the application, such as /projects.</param>
/// <param name="Marker">Text that proves the page has loaded; empty when there is none.</param>
public sealed record PageEntry(string Name, string Route, string Marker);

/// <summary>
/// The page list and its rules. Pages are kept per project: one shared list for every project, and each project's own list
/// that adds to it or overrides a page of the same name. The lists are configuration blocks the worker reads at run time.
/// </summary>
public static partial class PageList
{
    /// <summary>The most pages one list may hold.</summary>
    public const int MaxPages = 200;

    private const string Key = "pages";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>The block a list is kept in. The shared list keeps the original name, so existing setups keep working.</summary>
    /// <param name="projectId">The project, or null for the shared list.</param>
    /// <returns>The block's name.</returns>
    public static string KeyOf(int? projectId) => projectId is > 0 ? $"{Key}:{projectId}" : Key;

    /// <summary>Reads a saved list; an unreadable or missing block is an empty list.</summary>
    /// <param name="json">The block's JSON, or null.</param>
    /// <returns>The pages.</returns>
    public static IReadOnlyList<PageEntry> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        try
        {
            return [.. (JsonSerializer.Deserialize<List<PageEntry>>(json, Json) ?? []).Select(p => p with { Marker = p.Marker ?? string.Empty })];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>The block's JSON for a list.</summary>
    /// <param name="pages">The pages.</param>
    /// <returns>JSON.</returns>
    public static string Serialize(IReadOnlyList<PageEntry> pages) => JsonSerializer.Serialize(pages, Json);

    /// <summary>
    /// Checks a list and names each problem next to the input it belongs to (<c>pages.2.route</c>). Names must be unique,
    /// ignoring case, since steps refer to pages by name.
    /// </summary>
    /// <param name="pages">The pages as typed (trimmed here).</param>
    /// <returns>The problems by field; empty when the list is fine.</returns>
    public static Dictionary<string, string> Check(IReadOnlyList<PageEntry> pages)
    {
        ArgumentNullException.ThrowIfNull(pages);
        var problems = new Dictionary<string, string>(StringComparer.Ordinal);
        if (pages.Count > MaxPages)
        {
            problems["pages"] = $"Use {MaxPages} pages or fewer.";
        }

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < pages.Count; i++)
        {
            var page = pages[i];
            if (!NamePattern().IsMatch(page.Name.Trim()))
            {
                problems[$"pages.{i}.name"] = "Use letters, digits, spaces, - or _ (up to 60).";
            }
            else if (!seen.Add(page.Name.Trim()))
            {
                problems[$"pages.{i}.name"] = "This name is already used.";
            }

            if (!RoutePattern().IsMatch(page.Route.Trim()))
            {
                problems[$"pages.{i}.route"] = "Use a path on the application, such as /projects.";
            }

            if (page.Marker.Trim().Length > 200)
            {
                problems[$"pages.{i}.marker"] = "Use 200 characters or fewer.";
            }
        }

        return problems;
    }

    /// <summary>A list with every value trimmed, as it is saved.</summary>
    /// <param name="pages">The pages as typed.</param>
    /// <returns>The trimmed pages.</returns>
    public static IReadOnlyList<PageEntry> Trimmed(IReadOnlyList<PageEntry> pages)
    {
        ArgumentNullException.ThrowIfNull(pages);
        return [.. pages.Select(p => new PageEntry(p.Name.Trim(), p.Route.Trim(), p.Marker.Trim()))];
    }

    [GeneratedRegex(@"^[A-Za-z0-9][\w -]{0,59}$", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex NamePattern();

    [GeneratedRegex(@"^/(?!/)[^\s\\]*$", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex RoutePattern();
}
