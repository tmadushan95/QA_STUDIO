using QaStudio.Application.Abstractions;
using QaStudio.Core.MasterData;

namespace QaStudio.Application.Features.ProjectVersions.Common;

/// <summary>Builds version responses from the cached lists and fresh counts.</summary>
/// <param name="masterData">Master data lists.</param>
/// <param name="cases">Test case counts.</param>
internal sealed class ProjectVersionResponseBuilder(IMasterDataReader masterData, ITestCaseReader cases)
{
    /// <summary>Builds responses, newest release first within each project.</summary>
    /// <param name="projectId">Only this project's versions, when given.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The responses.</returns>
    public async Task<IReadOnlyList<ProjectVersionResponse>> BuildAllAsync(int? projectId, CancellationToken cancellationToken)
    {
        var projects = await masterData.ListProjectsAsync(cancellationToken).ConfigureAwait(false);
        var versions = await masterData.ListVersionsAsync(cancellationToken).ConfigureAwait(false);
        var counts = await cases.CountByVersionAsync(cancellationToken).ConfigureAwait(false);
        var names = projects.ToDictionary(p => p.Id, p => p.Name);
        return
        [
            .. versions.Where(v => projectId is null || v.ProjectId == projectId).Select(v => new ProjectVersionResponse
            {
                Id = v.Id,
                ProjectId = v.ProjectId,
                ProjectName = names.GetValueOrDefault(v.ProjectId, string.Empty),
                Name = v.Name,
                Description = v.Description,
                ReleaseDate = v.ReleaseDate,
                IsCurrent = v.IsCurrent,
                IsActive = v.IsActive,
                TestCaseCount = counts.GetValueOrDefault(v.Id),
                RowVersion = v.RowVersion,
            }),
        ];
    }

    /// <summary>Builds the response for one version.</summary>
    /// <param name="id">The key.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The response.</returns>
    /// <exception cref="Core.Common.NotFoundException">There is no such version.</exception>
    public async Task<ProjectVersionResponse> BuildAsync(int id, CancellationToken cancellationToken)
    {
        var all = await BuildAllAsync(null, cancellationToken).ConfigureAwait(false);
        return all.FirstOrDefault(v => v.Id == id) ?? throw ProjectVersionErrors.NotFound();
    }
}
