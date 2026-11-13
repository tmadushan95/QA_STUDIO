using QaStudio.Application.Abstractions;
using QaStudio.Core.Automation;

namespace QaStudio.Application.Features.WorkerState.ApplyWorkerOperations.Strategies;

/// <summary>Writes of configuration blocks.</summary>
/// <param name="store">The document store.</param>
internal sealed class ConfigOperations(IWorkerStateStore store) : WorkerOperationHandler
{
    protected override Dictionary<string, Func<WorkerOperation, CancellationToken, Task>> BuildRoutes() => new(StringComparer.Ordinal)
    {
        [WorkerOperationKinds.ConfigUpsert] = (o, ct) =>
            store.UpsertConfigAsync(ConfigEntry.Create(WorkerPayload.Key(o), WorkerPayload.Required(o).GetRawText()), ct),
    };
}
