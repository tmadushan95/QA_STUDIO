using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using QaStudio.Application.Abstractions;
using QaStudio.Core.Common;

namespace QaStudio.Infrastructure.Persistence;

/// <summary>Commits through the context and turns SQL Server's refusals into the application's conflicts.</summary>
/// <param name="db">The context.</param>
internal sealed class UnitOfWork(QaStudioDbContext db) : IUnitOfWork
{
    private const int ForeignKeyViolation = 547;
    private const int UniqueIndexViolation = 2601;
    private const int UniqueConstraintViolation = 2627;

    public async Task SaveChangesAsync(CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (DbUpdateConcurrencyException e)
        {
            throw new ConflictException("changed-since-opened", "This was changed since you opened it. Reload it to see the change.", null, e);
        }
        catch (DbUpdateException e) when (e.GetBaseException() is SqlException { Number: UniqueIndexViolation or UniqueConstraintViolation })
        {
            // The handlers check first for a friendly message; this is the race two simultaneous saves can still hit.
            throw new ConflictException("duplicate", "That is already in use. Reload and try again.", null, e);
        }
        catch (DbUpdateException e) when (e.GetBaseException() is SqlException { Number: ForeignKeyViolation })
        {
            throw new ConflictException("in-use", "Something still refers to this, or what it refers to no longer exists.", null, e);
        }
    }

    public Task ExecuteInTransactionAsync(Func<CancellationToken, Task> work, CancellationToken cancellationToken) =>
        db.Database.CreateExecutionStrategy().ExecuteAsync(
            async ct =>
            {
                // A retry starts clean, so entities from the failed attempt are not saved twice.
                db.ChangeTracker.Clear();
                var transaction = await db.Database.BeginTransactionAsync(ct).ConfigureAwait(false);
                await using (transaction.ConfigureAwait(false))
                {
                    await work(ct).ConfigureAwait(false);
                    await transaction.CommitAsync(ct).ConfigureAwait(false);
                }
            },
            cancellationToken);
}

