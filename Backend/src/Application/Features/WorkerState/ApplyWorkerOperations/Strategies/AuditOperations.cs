using QaStudio.Application.Abstractions;
using QaStudio.Core.Automation;

namespace QaStudio.Application.Features.WorkerState.ApplyWorkerOperations.Strategies;

/// <summary>Audit entries the worker recorded, kept with their original times.</summary>
/// <param name="store">The document store.</param>
internal sealed class AuditOperations(IWorkerStateStore store) : WorkerOperationHandler
{
    protected override Dictionary<string, Func<WorkerOperation, CancellationToken, Task>> BuildRoutes() => new(StringComparer.Ordinal)
    {
        [WorkerOperationKinds.AuditAdd] = (o, _) =>
        {
            var p = WorkerPayload.Required(o);
            store.AddAudit(AuditEntry.Record(WorkerPayload.Date(p, "at"), WorkerPayload.Text(p, "action"), WorkerPayload.Text(p, "target"), WorkerPayload.Text(p, "detail")));
            return Task.CompletedTask;
        },
    };
}
