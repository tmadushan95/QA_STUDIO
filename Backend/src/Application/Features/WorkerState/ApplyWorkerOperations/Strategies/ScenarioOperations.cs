using QaStudio.Application.Abstractions;
using QaStudio.Core.Automation;
using QaStudio.Core.Common;

namespace QaStudio.Application.Features.WorkerState.ApplyWorkerOperations.Strategies;

/// <summary>Writes of scenarios and their revisions.</summary>
/// <param name="store">The document store.</param>
internal sealed class ScenarioOperations(IWorkerStateStore store) : WorkerOperationHandler
{
    private const int FirstVersion = 1;

    protected override Dictionary<string, Func<WorkerOperation, CancellationToken, Task>> BuildRoutes() => new(StringComparer.Ordinal)
    {
        [WorkerOperationKinds.ScenarioUpsert] = (o, ct) => store.UpsertScenarioAsync(ToScenario(o), ct),
        [WorkerOperationKinds.ScenarioDelete] = (o, ct) => store.DeleteScenarioAsync(WorkerPayload.Key(o), ParseSlot(o), ct),
        [WorkerOperationKinds.ScenarioDeleteAll] = (_, ct) => store.DeleteAllScenariosAsync(ct),
        [WorkerOperationKinds.RevisionUpsert] = (o, ct) => store.UpsertRevisionAsync(ToRevision(o), ct),
    };

    private static ScenarioSlot ParseSlot(WorkerOperation operation) =>
        ScenarioSlotNames.Parse(operation.Slot)
            ?? throw new RequestValidationException(ErrorCodes.InvalidOperation, "Scenario slot must be draft or approved.");

    private static ScenarioRecord ToScenario(WorkerOperation operation)
    {
        var p = WorkerPayload.Required(operation);
        return ScenarioRecord.Create(
            WorkerPayload.Key(operation),
            ParseSlot(operation),
            p.TryGetProperty("version", out var v) ? v.GetInt32() : FirstVersion,
            WorkerPayload.OptionalText(p, "status"),
            p.GetRawText());
    }

    private static ScenarioRevision ToRevision(WorkerOperation operation) =>
        ScenarioRevision.Create(
            WorkerPayload.Key(operation),
            operation.Version ?? throw new RequestValidationException(ErrorCodes.InvalidOperation, "A revision needs a version."),
            WorkerPayload.Required(operation).GetRawText());
}
