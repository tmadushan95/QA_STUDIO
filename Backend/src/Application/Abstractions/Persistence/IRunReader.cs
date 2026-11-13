using System.Text.Json.Nodes;

namespace QaStudio.Application.Abstractions;

/// <summary>Stored runs for a list, and the cases they are narrowed to when the list is for one project or version.</summary>
/// <param name="Runs">The run documents, newest first.</param>
/// <param name="CaseCodesInScope">The cases of the project/version, or null when the list is not narrowed.</param>
public sealed record RunHistory(IReadOnlyList<JsonObject> Runs, IReadOnlySet<string>? CaseCodesInScope);

/// <summary>
/// Reads stored runs. A run is the worker's document (steps, evidence paths, failures…); the API passes it through as it is
/// and only adds a summary, so nothing the worker adds to a run needs a change here.
/// </summary>
public interface IRunReader
{
    /// <summary>Reads the run history: every run still going, and the most recent finished ones.</summary>
    /// <param name="projectId">Only this project's cases, when given.</param>
    /// <param name="versionId">Only this version's cases, when given.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The history.</returns>
    Task<RunHistory> ListAsync(int? projectId, int? versionId, CancellationToken cancellationToken);

    /// <summary>Reads one run.</summary>
    /// <param name="id">The run ID.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The run document, or null when there is none.</returns>
    Task<JsonObject?> GetAsync(string id, CancellationToken cancellationToken);
}
