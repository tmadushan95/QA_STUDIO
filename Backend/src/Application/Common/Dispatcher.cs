using System.Collections.Concurrent;
using Microsoft.Extensions.DependencyInjection;
using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Common;

/// <summary>
/// The mediator. A small in-house one, because the popular library went commercial and only this much of it is needed:
/// find the handler, wrap it in the registered behaviors, call it.
/// </summary>
/// <param name="services">The request's service scope.</param>
internal sealed class Dispatcher(IServiceProvider services) : IDispatcher
{
    private static readonly ConcurrentDictionary<(Type Request, Type Result), object> Invokers = new();

    public Task<TResult> SendAsync<TResult>(IRequest<TResult> request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var invoker = (IRequestInvoker<TResult>)Invokers.GetOrAdd(
            (request.GetType(), request.ResultType),
            static key => Activator.CreateInstance(typeof(RequestInvoker<,>).MakeGenericType(key.Request, key.Result))!);
        return invoker.InvokeAsync(request, services, cancellationToken);
    }
}

/// <summary>Lets the dispatcher call a handler knowing only the result type.</summary>
/// <typeparam name="TResult">The result.</typeparam>
internal interface IRequestInvoker<TResult>
{
    /// <summary>Runs the request through its behaviors and handler.</summary>
    /// <param name="request">The request.</param>
    /// <param name="services">The request's service scope.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The handler's result.</returns>
    Task<TResult> InvokeAsync(IRequest<TResult> request, IServiceProvider services, CancellationToken cancellationToken);
}

/// <summary>Calls the handler of one request type, wrapped in its behaviors.</summary>
/// <typeparam name="TRequest">The request.</typeparam>
/// <typeparam name="TResult">The result.</typeparam>
internal sealed class RequestInvoker<TRequest, TResult> : IRequestInvoker<TResult>
    where TRequest : IRequest<TResult>
{
    public Task<TResult> InvokeAsync(IRequest<TResult> request, IServiceProvider services, CancellationToken cancellationToken)
    {
        var typed = (TRequest)request;
        var handler = services.GetRequiredService<IRequestHandler<TRequest, TResult>>();
        Func<Task<TResult>> pipeline = () => handler.HandleAsync(typed, cancellationToken);
        foreach (var behavior in services.GetServices<IPipelineBehavior<TRequest, TResult>>().Reverse())
        {
            var next = pipeline;
            pipeline = () => behavior.HandleAsync(typed, next, cancellationToken);
        }

        return pipeline();
    }
}
