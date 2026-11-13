using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace QaStudio.Application.Features.Parameters.Common;

/// <summary>One parameter of one case, as the pages show it.</summary>
/// <param name="Name">The parameter name steps read as <c>{{data.name}}</c>.</param>
/// <param name="Value">The case's own value; empty when it inherits the common value or has none.</param>
/// <param name="Common">The project's common value for this name, when there is one.</param>
/// <param name="Source">Which layer a run uses: <c>case</c>, <c>common</c> or <c>missing</c>.</param>
/// <param name="Used">True when the case's steps read it; false for a value kept from earlier steps.</param>
public sealed record ParameterItem(
    string Name,
    string Value,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Common,
    string Source,
    bool Used);

/// <summary>Every parameter of one case.</summary>
/// <param name="CaseId">The case ID.</param>
/// <param name="ProjectId">The project whose common values the case inherits.</param>
/// <param name="Items">The parameters.</param>
/// <param name="Missing">Names the steps read that have no value yet: the case is blocked until they are set.</param>
public sealed record CaseParameters(
    string CaseId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? ProjectId,
    IReadOnlyList<ParameterItem> Items,
    IReadOnlyList<string> Missing);

/// <summary>One row of the summary the list pages use for their "missing values" column.</summary>
/// <param name="CaseId">The case ID.</param>
/// <param name="Needed">How many values the case needs.</param>
/// <param name="Missing">Which of them have no value.</param>
public sealed record ParameterSummaryRow(string CaseId, int Needed, IReadOnlyList<string> Missing);

/// <summary>One common value of a project, with how many of its cases use and override it.</summary>
/// <param name="Name">The parameter name.</param>
/// <param name="Value">The common value; empty when none is set yet.</param>
/// <param name="UsedBy">Cases of the project whose steps read this name.</param>
/// <param name="OverriddenBy">Of those, how many set their own value instead.</param>
public sealed record CommonItem(string Name, string Value, int UsedBy, int OverriddenBy);

/// <summary>A project's common values, including names its cases read that have none yet.</summary>
/// <param name="ProjectId">The project.</param>
/// <param name="Items">The names, sorted.</param>
public sealed record CommonParameters(int ProjectId, IReadOnlyList<CommonItem> Items);

/// <summary>
/// What a case's steps need and what values they have, in two layers resolved per name when a case runs: the case's own
/// value wins, else the project's common value, else the name is missing and the case is blocked. Pure: it reads nothing, so
/// the rules are covered by plain unit tests. The values themselves are edited by the worker (with the AI's help to fill them).
/// </summary>
public static partial class ParameterViews
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>A flat block of values (<c>{ "name": "value" }</c>), as the retired Test data page left it. Unreadable is empty.</summary>
    /// <param name="json">The block's JSON, or null.</param>
    /// <returns>Name to value.</returns>
    public static Dictionary<string, string> ParseFlat(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return new Dictionary<string, string>(StringComparer.Ordinal);
        }

        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, string>>(json, Json) ?? new Dictionary<string, string>(StringComparer.Ordinal);
        }
        catch (JsonException)
        {
            return new Dictionary<string, string>(StringComparer.Ordinal);
        }
    }

    /// <summary>
    /// The parameter names a scenario's steps read through <c>{{data.name}}</c>, in first-seen order, each once. Only the
    /// values of a step's parameters are searched, as the worker does when it runs the case.
    /// </summary>
    /// <param name="scenarioJson">The stored scenario record (draft when there is one, else the approved one), or null.</param>
    /// <returns>The names.</returns>
    public static IReadOnlyList<string> NeededNames(string? scenarioJson)
    {
        var found = new List<string>();
        if (string.IsNullOrWhiteSpace(scenarioJson))
        {
            return found;
        }

        try
        {
            using var doc = JsonDocument.Parse(scenarioJson);
            if (doc.RootElement.TryGetProperty("scenario", out var scenario)
                && scenario.TryGetProperty("steps", out var steps)
                && steps.ValueKind == JsonValueKind.Array)
            {
                foreach (var step in steps.EnumerateArray().Where(s => s.TryGetProperty("params", out _)))
                {
                    Collect(step.GetProperty("params"), found);
                }
            }
        }
        catch (JsonException)
        {
            // A scenario that cannot be read reads no parameters.
        }

        return found;
    }

    /// <summary>A case's parameters: every name its steps read plus any value kept from earlier steps, with where each comes from.</summary>
    /// <param name="caseCode">The case ID.</param>
    /// <param name="projectId">The project the case is filed under.</param>
    /// <param name="needed">The names its steps read.</param>
    /// <param name="own">The case's own values.</param>
    /// <param name="common">The project's common values.</param>
    /// <returns>The case's parameters.</returns>
    public static CaseParameters ForCase(
        string caseCode,
        int? projectId,
        IReadOnlyList<string> needed,
        IReadOnlyDictionary<string, string> own,
        IReadOnlyDictionary<string, string> common)
    {
        ArgumentNullException.ThrowIfNull(needed);
        ArgumentNullException.ThrowIfNull(own);
        ArgumentNullException.ThrowIfNull(common);
        static bool Has(IReadOnlyDictionary<string, string> layer, string name) =>
            layer.TryGetValue(name, out var value) && value.Length > 0;
        string SourceOf(string name)
        {
            if (Has(own, name))
            {
                return "case";
            }

            return Has(common, name) ? "common" : "missing";
        }

        var names = needed.Concat(own.Keys).Distinct(StringComparer.Ordinal).ToList();
        var items = names.Select(name => new ParameterItem(
            name,
            own.GetValueOrDefault(name) ?? string.Empty,
            common.TryGetValue(name, out var cv) && cv.Length > 0 ? cv : null,
            SourceOf(name),
            needed.Contains(name, StringComparer.Ordinal))).ToList();
        return new CaseParameters(caseCode, projectId, items, [.. needed.Where(n => SourceOf(n) == "missing")]);
    }

    /// <summary>For list pages: how many values each case needs and which are missing. Cases that need none are left out.</summary>
    /// <param name="cases">Each case with its project and the names its steps read.</param>
    /// <param name="ownByCase">Every case's own values.</param>
    /// <param name="commonByProject">Every project's common values.</param>
    /// <returns>One row per case that needs values.</returns>
    public static IReadOnlyList<ParameterSummaryRow> Summary(
        IEnumerable<(string Code, int? ProjectId, IReadOnlyList<string> Needed)> cases,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> ownByCase,
        IReadOnlyDictionary<int, IReadOnlyDictionary<string, string>> commonByProject)
    {
        ArgumentNullException.ThrowIfNull(cases);
        ArgumentNullException.ThrowIfNull(ownByCase);
        ArgumentNullException.ThrowIfNull(commonByProject);
        var rows = new List<ParameterSummaryRow>();
        foreach (var (code, projectId, needed) in cases.Where(c => c.Needed.Count > 0))
        {
            var common = projectId is { } p ? commonByProject.GetValueOrDefault(p) : null;
            var own = ownByCase.GetValueOrDefault(code);
            bool Has(string name) =>
                (own is not null && own.TryGetValue(name, out var o) && o.Length > 0)
                || (common is not null && common.TryGetValue(name, out var c) && c.Length > 0);
            rows.Add(new ParameterSummaryRow(code, needed.Count, [.. needed.Where(n => !Has(n))]));
        }

        return rows;
    }

    /// <summary>A project's common values, plus every name its cases read that has no common value yet.</summary>
    /// <param name="projectId">The project.</param>
    /// <param name="cases">The project's cases with the names their steps read.</param>
    /// <param name="ownByCase">Every case's own values.</param>
    /// <param name="common">The project's common values.</param>
    /// <returns>The common values, names sorted.</returns>
    public static CommonParameters ForProject(
        int projectId,
        IEnumerable<(string Code, IReadOnlyList<string> Needed)> cases,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> ownByCase,
        IReadOnlyDictionary<string, string> common)
    {
        ArgumentNullException.ThrowIfNull(cases);
        ArgumentNullException.ThrowIfNull(ownByCase);
        ArgumentNullException.ThrowIfNull(common);
        var usedBy = new Dictionary<string, int>(StringComparer.Ordinal);
        var overriddenBy = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var (code, needed) in cases)
        {
            foreach (var name in needed)
            {
                usedBy[name] = usedBy.GetValueOrDefault(name) + 1;
                if (ownByCase.TryGetValue(code, out var own) && own.TryGetValue(name, out var v) && v.Length > 0)
                {
                    overriddenBy[name] = overriddenBy.GetValueOrDefault(name) + 1;
                }
            }
        }

        var order = StringComparer.Create(CultureInfo.InvariantCulture, ignoreCase: false);
        var names = common.Keys.Concat(usedBy.Keys).Distinct(StringComparer.Ordinal).OrderBy(n => n, order);
        return new CommonParameters(
            projectId,
            [.. names.Select(n => new CommonItem(n, common.GetValueOrDefault(n) ?? string.Empty, usedBy.GetValueOrDefault(n), overriddenBy.GetValueOrDefault(n)))]);
    }

    private static void Collect(JsonElement value, List<string> found)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.String:
                foreach (Match m in DataReference().Matches(value.GetString() ?? string.Empty))
                {
                    var name = m.Groups[1].Value;
                    if (!found.Contains(name, StringComparer.Ordinal))
                    {
                        found.Add(name);
                    }
                }

                break;
            case JsonValueKind.Array:
                foreach (var item in value.EnumerateArray())
                {
                    Collect(item, found);
                }

                break;
            case JsonValueKind.Object:
                foreach (var property in value.EnumerateObject())
                {
                    Collect(property.Value, found);
                }

                break;
        }
    }

    [GeneratedRegex(@"\{\{\s*data\.([A-Za-z][\w-]*)\s*\}\}", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex DataReference();
}
