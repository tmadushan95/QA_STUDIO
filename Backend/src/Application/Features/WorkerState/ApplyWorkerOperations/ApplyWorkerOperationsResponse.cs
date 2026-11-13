namespace QaStudio.Application.Features.WorkerState.ApplyWorkerOperations;

/// <summary>The outcome of a batch write.</summary>
/// <param name="Applied">How many were applied.</param>
public sealed record ApplyWorkerOperationsResponse(int Applied);
