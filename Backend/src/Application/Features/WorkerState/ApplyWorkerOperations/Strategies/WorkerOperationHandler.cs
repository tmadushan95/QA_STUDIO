namespace QaStudio.Application.Features.WorkerState.ApplyWorkerOperations.Strategies;

/// <summary>A strategy whose kinds and actions are one table, so a kind cannot be listed without being handled.</summary>
internal abstract class WorkerOperationHandler : IWorkerOperationHandler
{
    private Dictionary<string, Func<WorkerOperation, CancellationToken, Task>>? _routes;

    /// <inheritdoc />
    public IReadOnlyCollection<string> Kinds => Routes.Keys;

    private Dictionary<string, Func<WorkerOperation, CancellationToken, Task>> Routes =>
        _routes ??= BuildRoutes();

    /// <inheritdoc />
    public Task ApplyAsync(WorkerOperation operation, CancellationToken cancellationToken) =>
        Routes[operation.Kind](operation, cancellationToken);

    /// <summary>Which action applies each kind.</summary>
    /// <returns>Action by kind.</returns>
    protected abstract Dictionary<string, Func<WorkerOperation, CancellationToken, Task>> BuildRoutes();
}
