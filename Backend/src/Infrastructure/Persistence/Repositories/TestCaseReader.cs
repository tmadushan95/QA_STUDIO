using Microsoft.EntityFrameworkCore;
using QaStudio.Application.Abstractions;
using QaStudio.Core.TestCases;

namespace QaStudio.Infrastructure.Persistence.Repositories;

/// <summary>EF Core test case queries (the read side): no tracking, and compiled where the path is hot.</summary>
/// <param name="db">The context.</param>
internal sealed class TestCaseReader(QaStudioDbContext db) : ITestCaseReader
{
    private static readonly Func<QaStudioDbContext, string, CancellationToken, Task<TestCaseReadModel?>> GetQuery =
        EF.CompileAsyncQuery((QaStudioDbContext ctx, string code, CancellationToken _) =>
            ctx.TestCases.AsNoTracking()
                .Include(c => c.Steps)
                .Where(c => c.CaseCode == code)
                .Select(c => new TestCaseReadModel(
                    c,
                    c.TestSuite.Name,
                    c.TestSuite.ProjectId,
                    c.TestSuite.Project.Name,
                    ctx.ProjectVersions.Where(v => v.Id == c.ProjectVersionId).Select(v => v.Name).FirstOrDefault()))
                .FirstOrDefault());

    public Task<TestCaseReadModel?> GetAsync(string caseCode, CancellationToken cancellationToken) =>
        GetQuery(db, caseCode, cancellationToken);

    public async Task<IReadOnlyList<TestCaseReadModel>> GetManyAsync(IReadOnlyCollection<string> caseCodes, CancellationToken cancellationToken) =>
        await Project(db, db.TestCases.Where(c => caseCodes.Contains(c.CaseCode)).OrderBy(c => c.Id))
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

    public async Task<(IReadOnlyList<TestCaseReadModel> Items, int Total)> ListAsync(TestCaseFilter filter, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(filter);
        var query = db.TestCases.AsQueryable();
        if (filter.TestSuiteId is { } suiteId)
        {
            query = query.Where(c => c.TestSuiteId == suiteId);
        }

        if (filter.ProjectId is { } projectId)
        {
            query = query.Where(c => c.TestSuite.ProjectId == projectId);
        }

        if (filter.ProjectVersionId is { } versionId)
        {
            query = query.Where(c => c.ProjectVersionId == versionId);
        }

        if (filter.Module is { } module)
        {
            query = query.Where(c => c.Module == module);
        }

        if (filter.Priority is { } priority)
        {
            query = query.Where(c => c.Priority == priority);
        }

        if (filter.Search is { } search)
        {
            query = query.Where(c => c.CaseCode.Contains(search) || c.Title.Contains(search) || (c.Module != null && c.Module.Contains(search)));
        }

        var total = await query.CountAsync(cancellationToken).ConfigureAwait(false);
        var items = await Project(db, query.OrderBy(c => c.Id).Skip((filter.Page - 1) * filter.PageSize).Take(filter.PageSize))
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        return (items, total);
    }

    public async Task<IReadOnlyDictionary<int, int>> CountBySuiteAsync(CancellationToken cancellationToken) =>
        await db.TestCases.AsNoTracking()
            .GroupBy(c => c.TestSuiteId)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.Key, g => g.Count, cancellationToken)
            .ConfigureAwait(false);

    public async Task<IReadOnlyDictionary<int, int>> CountByVersionAsync(CancellationToken cancellationToken) =>
        await db.TestCases.AsNoTracking()
            .Where(c => c.ProjectVersionId != null)
            .GroupBy(c => c.ProjectVersionId!.Value)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.Key, g => g.Count, cancellationToken)
            .ConfigureAwait(false);

    // Split query: joining steps into a page of cases would repeat every wide case row once per step.
    private static IQueryable<TestCaseReadModel> Project(QaStudioDbContext context, IQueryable<TestCase> query) =>
        query.AsNoTracking()
            .AsSplitQuery()
            .Include(c => c.Steps)
            .Select(c => new TestCaseReadModel(
                c,
                c.TestSuite.Name,
                c.TestSuite.ProjectId,
                c.TestSuite.Project.Name,
                context.ProjectVersions.Where(v => v.Id == c.ProjectVersionId).Select(v => v.Name).FirstOrDefault()));
}
