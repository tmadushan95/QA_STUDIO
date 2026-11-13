namespace QaStudio.Application.Abstractions;

/// <summary>Sends a request to its handler through the pipeline, so endpoints depend on no concrete handler.</summary>
public interface IDispatcher
{
    /// <summary>Sends a request.</summary>
    /// <typeparam name="TResult">The result type.</typeparam>
    /// <param name="request">The request.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The handler's result.</returns>
    Task<TResult> SendAsync<TResult>(IRequest<TResult> request, CancellationToken cancellationToken);
}
