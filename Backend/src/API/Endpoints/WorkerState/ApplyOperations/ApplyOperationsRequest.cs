using QaStudio.Application.Features.WorkerState.ApplyWorkerOperations;

namespace QaStudio.Api.Endpoints.WorkerState.ApplyOperations;

/// <summary>The body of a batch write.</summary>
/// <param name="Operations">The writes, in order.</param>
public sealed record ApplyOperationsRequest(IReadOnlyList<WorkerOperation> Operations);
