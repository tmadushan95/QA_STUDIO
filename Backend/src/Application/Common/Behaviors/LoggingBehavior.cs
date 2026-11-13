using System.Diagnostics;
using Microsoft.Extensions.Logging;
using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Common;

/// <summary>Logs every request's name, duration and outcome. Never its content, which may hold test data.</summary>
/// <typeparam name="TRequest">The request.</typeparam>
/// <typeparam name="TResult">The result.</typeparam>
/// <param name="logger">The logger.</param>
internal sealed partial class LoggingBehavior<TRequest, TResult>(ILogger<LoggingBehavior<TRequest, TResult>> logger)
    : IPipelineBehavior<TRequest, TResult>
    where TRequest : IRequest<TResult>
{
    private static readonly string RequestName = typeof(TRequest).Name;

    public async Task<TResult> HandleAsync(TRequest request, Func<Task<TResult>> continuation, CancellationToken cancellationToken)
    {
        var started = Stopwatch.GetTimestamp();
        var result = await continuation().ConfigureAwait(false);
        var elapsed = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
        LogHandled(logger, RequestName, elapsed);
        return result;
    }

    [LoggerMessage(Level = LogLevel.Debug, Message = "{Request} handled in {ElapsedMs} ms")]
    private static partial void LogHandled(ILogger logger, string request, double elapsedMs);
}
