using System.Text.Json.Nodes;

namespace QaStudio.Application.Features.Runs.Common;

/// <summary>
/// What the API does to a stored run document before returning it: add a summary, and (for a list of one project or
/// version) keep only the results of that project's cases. Pure, so the rules are covered by plain unit tests.
/// </summary>
public static class RunDocuments
{
    // The statuses a case result can have, in the order the summary lists them.
    private static readonly string[] Statuses = ["queued", "running", "passed", "failed", "skipped", "blocked", "cancelled"];

    /// <summary>Adds <c>summary</c> (total, count per status, pass rate) to a run, replacing any earlier one.</summary>
    /// <param name="run">The run document. Changed in place.</param>
    /// <returns>The same run.</returns>
    public static JsonObject WithSummary(JsonObject run)
    {
        ArgumentNullException.ThrowIfNull(run);
        var cases = run["cases"] as JsonArray ?? [];
        var counts = Statuses.ToDictionary(s => s, _ => 0, StringComparer.Ordinal);
        var statuses = cases
            .Select(c => (c as JsonObject)?["status"]?.GetValue<string>())
            .Where(status => status is not null && counts.ContainsKey(status));
        foreach (var status in statuses)
        {
            counts[status!]++;
        }

        var executed = counts["passed"] + counts["failed"];
        var countNode = new JsonObject();
        foreach (var status in Statuses)
        {
            countNode[status] = counts[status];
        }

        run["summary"] = new JsonObject
        {
            ["total"] = cases.Count,
            ["counts"] = countNode,
            ["passRate"] = executed == 0 ? null : (double)counts["passed"] / executed,
        };
        return run;
    }

    /// <summary>
    /// Keeps only the results of the given cases. A run records no project, so a list for one project is made by the cases
    /// it ran.
    /// </summary>
    /// <param name="run">The run document. Not changed.</param>
    /// <param name="caseCodes">The cases to keep.</param>
    /// <returns>A copy with only those results, or null when none are left (the run is then left out of the list).</returns>
    public static JsonObject? Narrow(JsonObject run, IReadOnlySet<string> caseCodes)
    {
        ArgumentNullException.ThrowIfNull(run);
        ArgumentNullException.ThrowIfNull(caseCodes);
        var kept = new JsonArray();
        foreach (var result in (run["cases"] as JsonArray ?? []).OfType<JsonObject>())
        {
            var code = result["caseId"]?.GetValue<string>();
            if (code is not null && caseCodes.Contains(code))
            {
                kept.Add(result.DeepClone());
            }
        }

        if (kept.Count == 0)
        {
            return null;
        }

        var copy = new JsonObject();
        foreach (var (key, value) in run)
        {
            copy[key] = key == "cases" ? kept : value?.DeepClone();
        }

        return copy;
    }
}
