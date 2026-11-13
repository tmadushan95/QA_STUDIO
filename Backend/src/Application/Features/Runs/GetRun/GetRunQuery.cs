using System.Text.Json.Nodes;
using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Features.Runs.GetRun;

/// <summary>Reads one run with its per-case results and a summary.</summary>
/// <param name="Id">The run ID.</param>
public sealed record GetRunQuery(string Id) : IQuery<JsonObject>;
