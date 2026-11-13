namespace QaStudio.Application.Abstractions;

/// <summary>
/// Configuration blocks: small named JSON documents the product keeps (the page list, for example). The worker reads the
/// same rows, so a block is a shared contract; the API only reads and writes the blocks it owns.
/// </summary>
public interface IConfigStore
{
    /// <summary>Reads one block.</summary>
    /// <param name="key">The block's name.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>Its JSON, or null when nothing was saved.</returns>
    Task<string?> GetJsonAsync(string key, CancellationToken cancellationToken);

    /// <summary>Reads a block and the blocks named <c>prefix:…</c> (one per project, for example).</summary>
    /// <param name="prefix">The block's name.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>Name to JSON.</returns>
    Task<IReadOnlyDictionary<string, string>> GetByPrefixAsync(string prefix, CancellationToken cancellationToken);

    /// <summary>Stages a block for saving; the unit of work commits it.</summary>
    /// <param name="key">The block's name.</param>
    /// <param name="json">Its JSON.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when the block is staged.</returns>
    Task SaveJsonAsync(string key, string json, CancellationToken cancellationToken);
}
