using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using QaStudio.Application.Abstractions;

namespace QaStudio.Infrastructure.Worker;

/// <summary>
/// Asks the worker (the only program that talks to the AI) for suggested parameter values. The AI is a convenience: when it
/// is off, the worker is stopped or the answer is bad, the answer is simply "no values" and the caller guesses from the names.
/// </summary>
/// <param name="http">The HTTP client.</param>
/// <param name="options">Worker settings.</param>
/// <param name="logger">The logger.</param>
internal sealed partial class WorkerParameterAi(HttpClient http, IOptions<WorkerOptions> options, ILogger<WorkerParameterAi> logger) : IParameterAi
{
    private static readonly Uri Route = new("/internal/parameters/ai-suggest", UriKind.Relative);

    private static readonly IReadOnlyDictionary<string, string> None = new Dictionary<string, string>();

    public async Task<IReadOnlyDictionary<string, string>> SuggestAsync(string title, IReadOnlyList<string> steps, IReadOnlyList<string> names, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, Route) { Content = JsonContent.Create(new { title, steps, names }) };
        request.Headers.TryAddWithoutValidation(WorkerNotifier.TokenHeader, options.Value.InternalToken);
        try
        {
            using var response = await http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                LogUnavailable(logger, (int)response.StatusCode);
                return None;
            }

            var body = await response.Content.ReadFromJsonAsync<AiAnswer>(cancellationToken).ConfigureAwait(false);
            return body?.Values ?? None;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException)
        {
            LogFailed(logger, e);
            return None;
        }
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "The worker gave no AI values ({Status}); names are guessed instead.")]
    private static partial void LogUnavailable(ILogger logger, int status);

    [LoggerMessage(Level = LogLevel.Information, Message = "The worker could not be asked for AI values; names are guessed instead.")]
    private static partial void LogFailed(ILogger logger, Exception exception);

    private sealed record AiAnswer(Dictionary<string, string>? Values);
}
