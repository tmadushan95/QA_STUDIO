using Microsoft.EntityFrameworkCore;
using QaStudio.Application.Abstractions;
using QaStudio.Core.MasterData;

namespace QaStudio.Infrastructure.Persistence.Repositories;

/// <summary>EF Core project repository.</summary>
/// <param name="context">The context.</param>
internal sealed class ProjectRepository(QaStudioDbContext context) : EfRepository<Project, int>(context), IProjectRepository
{
    public Task<Project?> FindAsync(int id, CancellationToken cancellationToken) =>
        Db.Projects.FirstOrDefaultAsync(p => p.Id == id, cancellationToken);

    public Task<Project?> FindByCodeAsync(string code, CancellationToken cancellationToken) =>
        Db.Projects.FirstOrDefaultAsync(p => p.Code == code, cancellationToken);

    public Task<int> CountSuitesAsync(int id, CancellationToken cancellationToken) =>
        Db.TestSuites.CountAsync(s => s.ProjectId == id, cancellationToken);

    public Task<int> CountAccountsAsync(int id, CancellationToken cancellationToken) =>
        Db.TestAccounts.CountAsync(a => a.ProjectId == id, cancellationToken);
}
