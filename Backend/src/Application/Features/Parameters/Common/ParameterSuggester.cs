using QaStudio.Application.Abstractions;
using QaStudio.Core.Automation;

namespace QaStudio.Application.Features.Parameters.Common;

/// <summary>A value filled automatically, and where it came from.</summary>
/// <param name="Name">The parameter name.</param>
/// <param name="Value">The suggested value.</param>
/// <param name="Source">The retired Test data page (<c>legacy</c>), the AI (<c>ai</c>), or a guess from the name (<c>guess</c>).</param>
public sealed record ParameterSuggestion(string Name, string Value, string Source);

/// <summary>
/// Suggests values for names that have none, without saving them. Each comes from the first source that has one: the values
/// of the retired Test data page, the AI (only when asked and set up), then a guess from the name. A name that looks like a
/// secret is never filled, by the AI or a guess.
/// </summary>
/// <param name="cases">Reads the cases.</param>
/// <param name="reads">Reads the views the names come from.</param>
/// <param name="config">Configuration blocks (the retired Test data values).</param>
/// <param name="ai">Asks the AI.</param>
/// <param name="clock">Clock.</param>
internal sealed class ParameterSuggester(IParameterCaseReader cases, ParameterReads reads, IConfigStore config, IParameterAi ai, IClock clock)
{
    private const string LegacyKey = "legacy-test-data";

    /// <summary>Suggests values for a case's missing parameters.</summary>
    /// <param name="caseCode">The case ID.</param>
    /// <param name="useAi">Whether to ask the AI.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>Suggestions in the order of the missing names.</returns>
    public async Task<IReadOnlyList<ParameterSuggestion>> ForCaseAsync(string caseCode, bool useAi, CancellationToken cancellationToken)
    {
        var view = await reads.CaseAsync(caseCode, cancellationToken).ConfigureAwait(false);
        return await ForMissingAsync(caseCode, view.Missing, useAi, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Suggests values for the missing names of a case whose view is already known.</summary>
    /// <param name="caseCode">The case ID.</param>
    /// <param name="missing">The names without a value.</param>
    /// <param name="useAi">Whether to ask the AI.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>Suggestions in the order of the missing names.</returns>
    public async Task<IReadOnlyList<ParameterSuggestion>> ForMissingAsync(string caseCode, IReadOnlyList<string> missing, bool useAi, CancellationToken cancellationToken)
    {
        if (missing.Count == 0)
        {
            return [];
        }

        var legacy = await LegacyAsync(cancellationToken).ConfigureAwait(false);
        var found = new Dictionary<string, ParameterSuggestion>(StringComparer.Ordinal);
        foreach (var name in missing.Where(n => legacy.TryGetValue(n, out var v) && v.Length > 0))
        {
            found[name] = new ParameterSuggestion(name, legacy[name], "legacy");
        }

        var rest = missing.Where(n => !found.ContainsKey(n)).ToList();
        if (useAi && rest.Count > 0)
        {
            foreach (var s in await FromAiAsync(caseCode, rest, cancellationToken).ConfigureAwait(false))
            {
                found[s.Name] = s;
            }
        }

        var now = clock.UtcNow;
        foreach (var name in missing.Where(n => !found.ContainsKey(n)))
        {
            if (ParameterGuess.Of(name, now) is { } guess)
            {
                found[name] = new ParameterSuggestion(name, guess, "guess");
            }
        }

        return [.. missing.Where(found.ContainsKey).Select(n => found[n])];
    }

    /// <summary>Suggests values for a project's empty common names: the retired Test data values, then a guess from the name.</summary>
    /// <param name="projectId">The project.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>Suggestions.</returns>
    public async Task<IReadOnlyList<ParameterSuggestion>> ForProjectAsync(int projectId, CancellationToken cancellationToken)
    {
        var legacy = await LegacyAsync(cancellationToken).ConfigureAwait(false);
        var now = clock.UtcNow;
        var suggestions = new List<ParameterSuggestion>();
        var empty = (await reads.ProjectAsync(projectId, cancellationToken).ConfigureAwait(false)).Items.Where(i => i.Value.Length == 0).Select(i => i.Name);
        foreach (var name in empty)
        {
            if (legacy.TryGetValue(name, out var old) && old.Length > 0)
            {
                suggestions.Add(new ParameterSuggestion(name, old, "legacy"));
            }
            else if (ParameterGuess.Of(name, now) is { } guess)
            {
                suggestions.Add(new ParameterSuggestion(name, guess, "guess"));
            }
        }

        return suggestions;
    }

    private async Task<List<ParameterSuggestion>> FromAiAsync(string caseCode, List<string> names, CancellationToken cancellationToken)
    {
        var context = await cases.ReadContextAsync(caseCode, cancellationToken).ConfigureAwait(false);
        if (context is null)
        {
            return [];
        }

        var answer = await ai.SuggestAsync(context.Title, context.Steps, names, cancellationToken).ConfigureAwait(false);
        var now = clock.UtcNow;
        var accepted = new List<ParameterSuggestion>();
        foreach (var name in names)
        {
            // A model answer is treated like any other input: bounded, and never for a name that looks secret.
            if (answer.TryGetValue(name, out var raw)
                && raw.Trim() is { Length: > 0 } value
                && value.Length <= ParameterLimits.ValueMaxLength
                && ParameterGuess.Of(name, now) is not null)
            {
                accepted.Add(new ParameterSuggestion(name, value, "ai"));
            }
        }

        return accepted;
    }

    private async Task<IReadOnlyDictionary<string, string>> LegacyAsync(CancellationToken cancellationToken)
    {
        var json = await config.GetJsonAsync(LegacyKey, cancellationToken).ConfigureAwait(false);
        return ParameterViews.ParseFlat(json);
    }
}
