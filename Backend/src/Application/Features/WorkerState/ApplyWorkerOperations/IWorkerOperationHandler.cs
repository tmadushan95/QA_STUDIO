namespace QaStudio.Application.Features.WorkerState.ApplyWorkerOperations;

/// <summary>A strategy for one family of operation kinds; adding a kind never changes the dispatcher.</summary>
internal interface IWorkerOperationHandler
{
    /// <summary>The kinds this strategy handles.</summary>
    IReadOnlyCollection<string> Kinds { get; }

    /// <summary>Applies one operation.</summary>
    /// <param name="operation">The operation.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when queued or applied.</returns>
    Task ApplyAsync(WorkerOperation operation, CancellationToken cancellationToken);
}
