using QaStudio.Application.Abstractions;
using QaStudio.Core.MasterData;

namespace QaStudio.Application.Features.Projects.Common;

/// <summary>Builds project responses from the cached lists and fresh counts.</summary>
/// <param name="masterData">Master data lists.</param>
/// <param name="cases">Test case counts.</param>
internal sealed class ProjectResponseBuilder(IMasterDataReader masterData, ITestCaseReader cases)
{
    /// <summary>Builds responses for every project.</summary>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The responses.</returns>
    public async Task<IReadOnlyList<ProjectResponse>> BuildAllAsync(CancellationToken cancellationToken)
    {
        var projects = await masterData.ListProjectsAsync(cancellationToken).ConfigureAwait(false);
        var suites = await masterData.ListSuitesAsync(cancellationToken).ConfigureAwait(false);
        // Counts change with every test case, so they are never cached with the lists.
        var counts = await cases.CountBySuiteAsync(cancellationToken).ConfigureAwait(false);
        var suitesByProject = suites.ToLookup(s => s.ProjectId);
        return
        [
            .. projects.Select(p => new ProjectResponse
            {
                Id = p.Id,
                Code = p.Code,
                Name = p.Name,
                Description = p.Description,
                IsActive = p.IsActive,
                SuiteCount = suitesByProject[p.Id].Count(),
                TestCaseCount = suitesByProject[p.Id].Sum(s => counts.GetValueOrDefault(s.Id)),
                RowVersion = p.RowVersion,
            }),
        ];
    }

    /// <summary>Builds the response for one project.</summary>
    /// <param name="id">The key.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The response.</returns>
    /// <exception cref="Core.Common.NotFoundException">There is no such project.</exception>
    public async Task<ProjectResponse> BuildAsync(int id, CancellationToken cancellationToken)
    {
        var all = await BuildAllAsync(cancellationToken).ConfigureAwait(false);
        return all.FirstOrDefault(p => p.Id == id) ?? throw ProjectErrors.NotFound();
    }
}
