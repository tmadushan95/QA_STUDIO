using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Common;

/// <summary>
/// What every change to projects or suites must do once it is made, in this order: commit, drop the cached lists so the
/// next read sees it, then tell open pages. In one place so a handler cannot forget a step or do them out of order.
/// </summary>
/// <param name="unitOfWork">Unit of work.</param>
/// <param name="cache">Master data cache.</param>
/// <param name="worker">Live update channel.</param>
internal sealed class MasterDataCommit(IUnitOfWork unitOfWork, IMasterDataCacheInvalidator cache, IWorkerNotifier worker)
{
    /// <summary>Commits the pending changes and announces them.</summary>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when done.</returns>
    public async Task SaveAndAnnounceAsync(CancellationToken cancellationToken)
    {
        await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        cache.Invalidate();
        await worker.MasterDataChangedAsync(cancellationToken).ConfigureAwait(false);
    }
}
