namespace QaStudio.Application.Abstractions;

/// <summary>Handles one request type.</summary>
/// <typeparam name="TRequest">The request.</typeparam>
/// <typeparam name="TResult">The result.</typeparam>
public interface IRequestHandler<in TRequest, TResult>
    where TRequest : IRequest<TResult>
{
    /// <summary>Handles the request.</summary>
    /// <param name="request">The request.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The result.</returns>
    Task<TResult> HandleAsync(TRequest request, CancellationToken cancellationToken);
}
