using QaStudio.Application.Abstractions;
using QaStudio.Core.MasterData;

namespace QaStudio.Application.Features.TestSuites.Common;

/// <summary>Builds suite responses from the cached lists and fresh counts.</summary>
/// <param name="masterData">Master data lists.</param>
/// <param name="cases">Test case counts.</param>
internal sealed class TestSuiteResponseBuilder(IMasterDataReader masterData, ITestCaseReader cases)
{
    /// <summary>Builds responses.</summary>
    /// <param name="projectId">Only this project's suites, when given.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The responses.</returns>
    public async Task<IReadOnlyList<TestSuiteResponse>> BuildAllAsync(int? projectId, CancellationToken cancellationToken)
    {
        var projects = await masterData.ListProjectsAsync(cancellationToken).ConfigureAwait(false);
        var suites = await masterData.ListSuitesAsync(cancellationToken).ConfigureAwait(false);
        var counts = await cases.CountBySuiteAsync(cancellationToken).ConfigureAwait(false);
        var names = projects.ToDictionary(p => p.Id, p => p.Name);
        return
        [
            .. suites.Where(s => projectId is null || s.ProjectId == projectId).Select(s => new TestSuiteResponse
            {
                Id = s.Id,
                ProjectId = s.ProjectId,
                ProjectName = names.GetValueOrDefault(s.ProjectId, string.Empty),
                Name = s.Name,
                Description = s.Description,
                SortOrder = s.SortOrder,
                IsActive = s.IsActive,
                TestCaseCount = counts.GetValueOrDefault(s.Id),
                RowVersion = s.RowVersion,
            }),
        ];
    }

    /// <summary>Builds the response for one suite.</summary>
    /// <param name="id">The key.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The response.</returns>
    /// <exception cref="Core.Common.NotFoundException">There is no such suite.</exception>
    public async Task<TestSuiteResponse> BuildAsync(int id, CancellationToken cancellationToken)
    {
        var all = await BuildAllAsync(null, cancellationToken).ConfigureAwait(false);
        return all.FirstOrDefault(s => s.Id == id) ?? throw TestSuiteErrors.NotFound();
    }
}
