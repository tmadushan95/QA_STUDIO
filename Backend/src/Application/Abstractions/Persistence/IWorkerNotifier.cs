using System.Text.Json;

namespace QaStudio.Application.Abstractions;

/// <summary>Tells the execution worker that test cases changed outside it, so its next run sees them.</summary>
public interface IWorkerNotifier
{
    /// <summary>Sends the changes. A worker that is down is not an error: it reloads when it starts.</summary>
    /// <param name="upserted">Changed cases in the API's JSON shape.</param>
    /// <param name="deleted">Removed case IDs.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when sent or given up on.</returns>
    Task TestCasesChangedAsync(IReadOnlyList<JsonElement> upserted, IReadOnlyList<string> deleted, CancellationToken cancellationToken);

    /// <summary>Tells open pages that master data changed, through the worker's live event stream.</summary>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when sent or given up on.</returns>
    Task MasterDataChangedAsync(CancellationToken cancellationToken);

    /// <summary>Tells the worker a configuration block it reads changed, with the new value.</summary>
    /// <param name="key">The block's name.</param>
    /// <param name="json">Its new JSON.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when the worker was told (or could not be).</returns>
    Task ConfigChangedAsync(string key, string json, CancellationToken cancellationToken);
}
