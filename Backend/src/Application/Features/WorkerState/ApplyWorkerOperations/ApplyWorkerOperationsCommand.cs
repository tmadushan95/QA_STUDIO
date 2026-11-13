using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Features.WorkerState.ApplyWorkerOperations;

/// <summary>Applies a batch of the worker's writes.</summary>
/// <param name="Operations">The writes, in order.</param>
public sealed record ApplyWorkerOperationsCommand(IReadOnlyList<WorkerOperation> Operations) : ICommand<ApplyWorkerOperationsResponse>;
