using QaStudio.Application.Abstractions;
using QaStudio.Core.Automation;

namespace QaStudio.Application.Features.WorkerState.ApplyWorkerOperations.Strategies;

/// <summary>Writes of test runs.</summary>
/// <param name="store">The document store.</param>
internal sealed class RunOperations(IWorkerStateStore store) : WorkerOperationHandler
{
    protected override Dictionary<string, Func<WorkerOperation, CancellationToken, Task>> BuildRoutes() => new(StringComparer.Ordinal)
    {
        [WorkerOperationKinds.RunUpsert] = (o, ct) => store.UpsertRunAsync(ToRun(o), ct),
        [WorkerOperationKinds.RunDeleteAll] = (_, ct) => store.DeleteAllRunsAsync(ct),
    };

    private static TestRun ToRun(WorkerOperation operation)
    {
        var p = WorkerPayload.Required(operation);
        return TestRun.Create(WorkerPayload.Key(operation), WorkerPayload.Date(p, "createdAt"), WorkerPayload.OptionalText(p, "status"), p.GetRawText());
    }
}
