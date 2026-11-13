using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using QaStudio.Application.Abstractions;

namespace QaStudio.Infrastructure.Worker;

/// <summary>
/// Calls the worker's internal sync routes. A failed notice never fails the user's save, which has already committed:
/// the worker reloads every case at start-up and again before each run, so it cannot run stale data.
/// </summary>
/// <param name="http">The HTTP client.</param>
/// <param name="options">Worker settings.</param>
/// <param name="logger">The logger.</param>
internal sealed partial class WorkerNotifier(HttpClient http, IOptions<WorkerOptions> options, ILogger<WorkerNotifier> logger) : IWorkerNotifier
{
    /// <summary>The header carrying the shared internal secret.</summary>
    public const string TokenHeader = "x-qa-internal-token";

    private static readonly Uri TestCasesRoute = new("/internal/sync/test-cases", UriKind.Relative);
    private static readonly Uri MasterDataRoute = new("/internal/sync/master-data", UriKind.Relative);
    private static readonly Uri ConfigRoute = new("/internal/sync/config", UriKind.Relative);

    public Task TestCasesChangedAsync(IReadOnlyList<JsonElement> upserted, IReadOnlyList<string> deleted, CancellationToken cancellationToken) =>
        PostAsync(TestCasesRoute, new { upserted, deleted }, cancellationToken);

    public Task MasterDataChangedAsync(CancellationToken cancellationToken) =>
        PostAsync(MasterDataRoute, new { }, cancellationToken);

    public Task ConfigChangedAsync(string key, string json, CancellationToken cancellationToken) =>
        PostAsync(ConfigRoute, new { key, value = JsonDocument.Parse(json).RootElement }, cancellationToken);

    private async Task PostAsync(Uri route, object body, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, route) { Content = JsonContent.Create(body) };
        request.Headers.TryAddWithoutValidation(TokenHeader, options.Value.InternalToken);
        try
        {
            using var response = await http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                LogRefused(logger, route, (int)response.StatusCode);
            }
        }
        catch (HttpRequestException e)
        {
            LogUnreachable(logger, route, e.Message);
        }
        catch (TaskCanceledException e) when (!cancellationToken.IsCancellationRequested)
        {
            LogUnreachable(logger, route, e.Message);
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Worker refused {Route} with status {Status}")]
    private static partial void LogRefused(ILogger logger, Uri route, int status);

    [LoggerMessage(Level = LogLevel.Information, Message = "Worker not reachable for {Route}: {Reason}. It reloads when it starts.")]
    private static partial void LogUnreachable(ILogger logger, Uri route, string reason);
}
