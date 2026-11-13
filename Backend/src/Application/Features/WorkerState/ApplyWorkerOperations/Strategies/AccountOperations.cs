using QaStudio.Application.Abstractions;
using QaStudio.Core.Automation;

namespace QaStudio.Application.Features.WorkerState.ApplyWorkerOperations.Strategies;

/// <summary>Writes of test accounts and their saved sessions. Ciphertext only: only the worker has the key.</summary>
/// <param name="store">The document store.</param>
internal sealed class AccountOperations(IWorkerStateStore store) : WorkerOperationHandler
{
    protected override Dictionary<string, Func<WorkerOperation, CancellationToken, Task>> BuildRoutes() => new(StringComparer.Ordinal)
    {
        [WorkerOperationKinds.AccountUpsert] = (o, ct) => store.UpsertAccountAsync(ToAccount(o), ct),
        [WorkerOperationKinds.AccountDelete] = (o, ct) => store.DeleteAccountAsync(WorkerPayload.Key(o), ct),
        [WorkerOperationKinds.SessionUpsert] = (o, ct) => store.UpsertSessionAsync(ToSession(o), ct),
        [WorkerOperationKinds.SessionDelete] = (o, ct) => store.DeleteSessionAsync(WorkerPayload.Key(o), ct),
    };

    private static TestAccount ToAccount(WorkerOperation operation)
    {
        var p = WorkerPayload.Required(operation);
        return TestAccount.Create(
            WorkerPayload.Key(operation),
            WorkerPayload.Int(p, "projectId"),
            WorkerPayload.Text(p, "label"),
            WorkerPayload.Text(p, "username"),
            WorkerPayload.Text(p, "passwordEnc"),
            WorkerPayload.Text(p, "createdAt"),
            WorkerPayload.Text(p, "updatedAt"));
    }

    private static AccountSession ToSession(WorkerOperation operation)
    {
        var p = WorkerPayload.Required(operation);
        return AccountSession.Create(WorkerPayload.Key(operation), WorkerPayload.Text(p, "stateEnc"), WorkerPayload.Text(p, "savedAt"));
    }
}
