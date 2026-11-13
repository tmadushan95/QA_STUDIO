using System.Text.Json.Nodes;
using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Features.Runs.ListRuns;

/// <summary>Reads the run history, newest first, each run with a summary.</summary>
/// <param name="ProjectId">Only the results of this project's cases, when given.</param>
/// <param name="VersionId">Only the results of this version's cases, when given.</param>
public sealed record ListRunsQuery(int? ProjectId = null, int? VersionId = null) : IQuery<IReadOnlyList<JsonObject>>;
