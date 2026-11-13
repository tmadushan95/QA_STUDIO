using QaStudio.Application.Abstractions;
using QaStudio.Core.Automation;

namespace QaStudio.Application.Features.WorkerState.ApplyWorkerOperations.Strategies;

/// <summary>Writes of the snapshots taken before clearing data.</summary>
/// <param name="store">The document store.</param>
internal sealed class BackupOperations(IWorkerStateStore store) : WorkerOperationHandler
{
    protected override Dictionary<string, Func<WorkerOperation, CancellationToken, Task>> BuildRoutes() => new(StringComparer.Ordinal)
    {
        [WorkerOperationKinds.BackupUpsert] = (o, ct) => store.UpsertBackupAsync(ToBackup(o), ct),
        [WorkerOperationKinds.BackupDelete] = (o, ct) => store.DeleteBackupAsync(WorkerPayload.Key(o), ct),
    };

    private static DataBackup ToBackup(WorkerOperation operation)
    {
        var p = WorkerPayload.Required(operation);
        return DataBackup.Create(WorkerPayload.Key(operation), WorkerPayload.Date(p, "createdAt"), WorkerPayload.Text(p, "reason"), p.GetRawText());
    }
}
