using Microsoft.EntityFrameworkCore;
using QaStudio.Application.Abstractions;
using QaStudio.Core.MasterData;

namespace QaStudio.Infrastructure.Persistence.Repositories;

/// <summary>EF Core project version repository (the write side).</summary>
/// <param name="context">The context.</param>
internal sealed class ProjectVersionRepository(QaStudioDbContext context) : EfRepository<ProjectVersion, int>(context), IProjectVersionRepository
{
    public Task<ProjectVersion?> FindAsync(int id, CancellationToken cancellationToken) =>
        Db.ProjectVersions.FirstOrDefaultAsync(v => v.Id == id, cancellationToken);

    public Task<ProjectVersion?> FindByNameAsync(int projectId, string name, CancellationToken cancellationToken) =>
        Db.ProjectVersions.FirstOrDefaultAsync(v => v.ProjectId == projectId && v.Name == name, cancellationToken);

    public async Task<IReadOnlyList<ProjectVersion>> FindCurrentAsync(int projectId, CancellationToken cancellationToken) =>
        await Db.ProjectVersions.Where(v => v.ProjectId == projectId && v.IsCurrent).ToListAsync(cancellationToken).ConfigureAwait(false);
}
