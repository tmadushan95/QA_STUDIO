namespace QaStudio.Application.Abstractions;

/// <summary>A request handled by exactly one handler. Prefer <see cref="ICommand{TResult}"/> or <see cref="IQuery{TResult}"/>.</summary>
/// <typeparam name="TResult">What the handler returns.</typeparam>
public interface IRequest<out TResult>
{
    /// <summary>What the handler returns, which is how the dispatcher finds the handler.</summary>
    Type ResultType => typeof(TResult);
}
