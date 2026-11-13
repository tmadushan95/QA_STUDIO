using System.Text.Json;
using Microsoft.Extensions.Options;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;
using QaStudio.Application.Features.WorkerState.GetWorkerTestCases;
using QaStudio.Core.Automation;

namespace QaStudio.Application.Features.WorkerState.GetWorkerSnapshot;

/// <summary>Handles <see cref="GetWorkerSnapshotQuery"/>.</summary>
/// <param name="store">The document store.</param>
/// <param name="dispatcher">Used to reuse the test case read.</param>
/// <param name="limits">Request limits.</param>
internal sealed class GetWorkerSnapshotHandler(IWorkerStateStore store, IDispatcher dispatcher, IOptions<LimitsOptions> limits)
    : IRequestHandler<GetWorkerSnapshotQuery, GetWorkerSnapshotResponse>
{
    public async Task<GetWorkerSnapshotResponse> HandleAsync(GetWorkerSnapshotQuery request, CancellationToken cancellationToken)
    {
        var cases = await dispatcher.SendAsync(new GetWorkerTestCasesQuery(), cancellationToken).ConfigureAwait(false);
        var state = await store.ReadAllAsync(limits.Value.SnapshotRuns, cancellationToken).ConfigureAwait(false);
        return new GetWorkerSnapshotResponse
        {
            TestCases = cases,
            Scenarios = [.. state.Scenarios.Select(s => new SnapshotScenario(ScenarioSlotNames.Of(s.Slot), s.CaseCode, Parse(s.Json)))],
            Revisions = [.. state.Revisions.Select(r => new SnapshotRevision(r.CaseCode, r.Version, Parse(r.Json)))],
            Runs = [.. state.Runs.Select(r => Parse(r.Json))],
            Config = state.Config.ToDictionary(c => c.Key, c => Parse(c.Json), StringComparer.Ordinal),
            Accounts = state.Accounts,
            Sessions = state.Sessions,
            AiKeys = state.AiKeys,
            Backups = [.. state.Backups.Select(b => Parse(b.Json))],
        };
    }

    private static JsonElement Parse(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }
}
