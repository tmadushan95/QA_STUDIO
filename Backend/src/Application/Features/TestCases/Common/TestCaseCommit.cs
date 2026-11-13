using QaStudio.Application.Abstractions;
using QaStudio.Core.TestCases;

namespace QaStudio.Application.Features.TestCases.Common;

/// <summary>
/// What saving one test case must do: commit, read it back with its place in the hierarchy, and tell the worker, whose
/// next run must see the change. In one place so create and update cannot differ.
/// </summary>
/// <param name="unitOfWork">Unit of work.</param>
/// <param name="reader">Test case queries.</param>
/// <param name="worker">Tells the worker about the change.</param>
internal sealed class TestCaseCommit(IUnitOfWork unitOfWork, ITestCaseReader reader, IWorkerNotifier worker)
{
    /// <summary>Commits the pending changes and announces the case.</summary>
    /// <param name="caseCode">The case ID.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The case as saved.</returns>
    public async Task<TestCaseResponse> SaveAndAnnounceAsync(string caseCode, CancellationToken cancellationToken)
    {
        await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        var saved = await reader.GetAsync(caseCode, cancellationToken).ConfigureAwait(false)
            ?? throw TestCaseErrors.NotFound(caseCode);
        var response = TestCaseMapper.ToResponse(saved);
        await worker.TestCasesChangedAsync([TestCaseMapper.ToWorkerJson(response)], [], cancellationToken).ConfigureAwait(false);
        return response;
    }
}
