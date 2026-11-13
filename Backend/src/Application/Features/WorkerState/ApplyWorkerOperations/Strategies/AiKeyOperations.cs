using QaStudio.Application.Abstractions;
using QaStudio.Core.Automation;

namespace QaStudio.Application.Features.WorkerState.ApplyWorkerOperations.Strategies;

/// <summary>Writes of AI provider keys. Ciphertext only.</summary>
/// <param name="store">The document store.</param>
internal sealed class AiKeyOperations(IWorkerStateStore store) : WorkerOperationHandler
{
    protected override Dictionary<string, Func<WorkerOperation, CancellationToken, Task>> BuildRoutes() => new(StringComparer.Ordinal)
    {
        [WorkerOperationKinds.AiKeyUpsert] = (o, ct) => store.UpsertAiKeyAsync(ToKey(o), ct),
        [WorkerOperationKinds.AiKeyDelete] = (o, ct) => store.DeleteAiKeyAsync(WorkerPayload.Key(o), ct),
    };

    private static AiProviderKey ToKey(WorkerOperation operation)
    {
        var p = WorkerPayload.Required(operation);
        return AiProviderKey.Create(WorkerPayload.Key(operation), WorkerPayload.Text(p, "keyEnc"), WorkerPayload.Text(p, "updatedAt"));
    }
}
