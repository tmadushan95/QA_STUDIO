using Microsoft.EntityFrameworkCore;
using QaStudio.Application.Abstractions;
using QaStudio.Core.MasterData;

namespace QaStudio.Infrastructure.Persistence.Repositories;

/// <summary>EF Core test suite repository.</summary>
/// <param name="context">The context.</param>
internal sealed class TestSuiteRepository(QaStudioDbContext context) : EfRepository<TestSuite, int>(context), ITestSuiteRepository
{
    public Task<TestSuite?> FindAsync(int id, CancellationToken cancellationToken) =>
        Db.TestSuites.FirstOrDefaultAsync(s => s.Id == id, cancellationToken);

    public Task<TestSuite?> FindByNameAsync(int projectId, string name, CancellationToken cancellationToken) =>
        Db.TestSuites.FirstOrDefaultAsync(s => s.ProjectId == projectId && s.Name == name, cancellationToken);

}
