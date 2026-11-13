namespace QaStudio.Application.Abstractions;

/// <summary>Commits the pending changes of one request as a single transaction.</summary>
public interface IUnitOfWork
{
    /// <summary>Commits pending changes. Translates duplicates and stale edits to <c>ConflictException</c>s.</summary>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when the changes are saved.</returns>
    Task SaveChangesAsync(CancellationToken cancellationToken);

    /// <summary>Runs work in one transaction, retried as a whole on a transient SQL failure.</summary>
    /// <param name="work">The work; it may be run more than once.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when the transaction is committed.</returns>
    Task ExecuteInTransactionAsync(Func<CancellationToken, Task> work, CancellationToken cancellationToken);
}
