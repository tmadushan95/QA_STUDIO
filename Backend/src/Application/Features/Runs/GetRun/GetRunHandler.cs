using System.Text.Json.Nodes;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Runs.Common;
using QaStudio.Core.Common;

namespace QaStudio.Application.Features.Runs.GetRun;

/// <summary>Handles <see cref="GetRunQuery"/>.</summary>
/// <param name="reader">Reads stored runs.</param>
internal sealed class GetRunHandler(IRunReader reader) : IRequestHandler<GetRunQuery, JsonObject>
{
    public async Task<JsonObject> HandleAsync(GetRunQuery request, CancellationToken cancellationToken)
    {
        var run = await reader.GetAsync(request.Id, cancellationToken).ConfigureAwait(false)
            ?? throw new NotFoundException(ErrorCodes.UnknownRun, "Run not found.");
        return RunDocuments.WithSummary(run);
    }
}
