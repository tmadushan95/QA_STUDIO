using System.Text.Json;

namespace QaStudio.Application.Features.WorkerState.ApplyWorkerOperations;

/// <summary>One write from the execution worker. Applied in order, inside one transaction per batch.</summary>
/// <param name="Kind">What to do; one of <see cref="WorkerOperationKinds"/>.</param>
/// <param name="Key">The row's main key, when the kind needs one.</param>
/// <param name="Slot">Scenario slot: <c>draft</c> or <c>approved</c>.</param>
/// <param name="Version">Revision number.</param>
/// <param name="Payload">The document or row.</param>
public sealed record WorkerOperation(string Kind, string? Key = null, string? Slot = null, int? Version = null, JsonElement? Payload = null);
