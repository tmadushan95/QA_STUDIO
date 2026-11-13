using System.Text.Json.Nodes;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Runs.Common;

namespace QaStudio.Application.Features.Runs.ListRuns;

/// <summary>Handles <see cref="ListRunsQuery"/>.</summary>
/// <param name="reader">Reads stored runs.</param>
internal sealed class ListRunsHandler(IRunReader reader) : IRequestHandler<ListRunsQuery, IReadOnlyList<JsonObject>>
{
    public async Task<IReadOnlyList<JsonObject>> HandleAsync(ListRunsQuery request, CancellationToken cancellationToken)
    {
        var history = await reader.ListAsync(request.ProjectId, request.VersionId, cancellationToken).ConfigureAwait(false);
        var runs = history.CaseCodesInScope is { } scope
            ? history.Runs.Select(r => RunDocuments.Narrow(r, scope)).OfType<JsonObject>()
            : history.Runs;
        return [.. runs.Select(RunDocuments.WithSummary)];
    }
}
