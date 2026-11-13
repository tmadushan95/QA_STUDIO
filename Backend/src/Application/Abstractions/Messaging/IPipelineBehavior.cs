namespace QaStudio.Application.Abstractions;

/// <summary>A decorator run around every handler, for cross-cutting work such as validation and logging.</summary>
/// <typeparam name="TRequest">The request.</typeparam>
/// <typeparam name="TResult">The result.</typeparam>
public interface IPipelineBehavior<in TRequest, TResult>
    where TRequest : IRequest<TResult>
{
    /// <summary>Runs around the next step of the pipeline.</summary>
    /// <param name="request">The request.</param>
    /// <param name="continuation">The next step.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The result.</returns>
    Task<TResult> HandleAsync(TRequest request, Func<Task<TResult>> continuation, CancellationToken cancellationToken);
}
