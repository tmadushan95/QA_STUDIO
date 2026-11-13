using Microsoft.EntityFrameworkCore;
using QaStudio.Application.Abstractions;
using QaStudio.Core.TestCases;

namespace QaStudio.Infrastructure.Persistence.Repositories;

/// <summary>EF Core test case repository (the write side).</summary>
/// <param name="context">The context.</param>
internal sealed class TestCaseRepository(QaStudioDbContext context) : EfRepository<TestCase, long>(context), ITestCaseRepository
{
    private static readonly Func<QaStudioDbContext, string, CancellationToken, Task<bool>> ExistsQuery =
        EF.CompileAsyncQuery((QaStudioDbContext ctx, string code, CancellationToken _) => ctx.TestCases.Any(c => c.CaseCode == code));

    public async Task<TestCase?> FindAsync(string caseCode, CancellationToken cancellationToken)
    {
        // A batch can write one case twice, and the first write may not be saved yet.
        var pending = Db.TestCases.Local.FirstOrDefault(c => string.Equals(c.CaseCode, caseCode, StringComparison.Ordinal));
        return pending ?? await Db.TestCases.Include(c => c.Steps)
            .FirstOrDefaultAsync(c => c.CaseCode == caseCode, cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<TestCase>> FindManyAsync(IReadOnlyCollection<string> caseCodes, CancellationToken cancellationToken) =>
        await Db.TestCases.Where(c => caseCodes.Contains(c.CaseCode)).ToListAsync(cancellationToken).ConfigureAwait(false);

    public Task<bool> ExistsAsync(string caseCode, CancellationToken cancellationToken) =>
        ExistsQuery(Db, caseCode, cancellationToken);

    public async Task<IReadOnlyList<string>> ListCodesAsync(CancellationToken cancellationToken) =>
        await Db.TestCases.AsNoTracking().Select(c => c.CaseCode).ToListAsync(cancellationToken).ConfigureAwait(false);

    public async Task<int> DeleteAllAsync(CancellationToken cancellationToken)
    {
        await Db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        var removed = await Db.TestCases.ExecuteDeleteAsync(cancellationToken).ConfigureAwait(false);
        Db.ChangeTracker.Clear();
        return removed;
    }
}
