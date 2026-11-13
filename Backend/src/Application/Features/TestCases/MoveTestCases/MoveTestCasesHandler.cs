using QaStudio.Application.Abstractions;
using QaStudio.Core.Common;
using QaStudio.Core.MasterData;

namespace QaStudio.Application.Features.TestCases.MoveTestCases;

/// <summary>Handles <see cref="MoveTestCasesCommand"/>.</summary>
/// <param name="cases">Test case repository.</param>
/// <param name="suites">Suite repository.</param>
/// <param name="audit">Audit trail.</param>
/// <param name="unitOfWork">Unit of work.</param>
/// <param name="worker">Tells open pages about the change.</param>
/// <param name="clock">Clock.</param>
internal sealed class MoveTestCasesHandler(
    ITestCaseRepository cases,
    ITestSuiteRepository suites,
    IAuditRepository audit,
    IUnitOfWork unitOfWork,
    IWorkerNotifier worker,
    IClock clock) : IRequestHandler<MoveTestCasesCommand, MoveTestCasesResponse>
{
    public async Task<MoveTestCasesResponse> HandleAsync(MoveTestCasesCommand request, CancellationToken cancellationToken)
    {
        var suite = await suites.FindAsync(request.TestSuiteId, cancellationToken).ConfigureAwait(false)
            ?? throw TestSuiteErrors.NoLongerExists();
        var ids = request.Ids.Distinct(StringComparer.Ordinal).ToList();
        var found = await cases.FindManyAsync(ids, cancellationToken).ConfigureAwait(false);
        var now = clock.UtcNow;
        foreach (var testCase in found)
        {
            testCase.MoveTo(suite.Id, now);
        }

        if (found.Count > 0)
        {
            audit.Add(AuditActions.CaseMove, suite.Name, $"Moved {Text.Count(found.Count, "test case")} to \"{suite.Name}\".");
            await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            // The worker re-reads every case before a run, so a move only needs open pages to refresh.
            await worker.MasterDataChangedAsync(cancellationToken).ConfigureAwait(false);
        }

        return new MoveTestCasesResponse(found.Count, ids.Count - found.Count);
    }
}
