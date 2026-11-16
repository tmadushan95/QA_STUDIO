using QaStudio.Application.Abstractions;
using QaStudio.Core.Common;

namespace QaStudio.Application.Features.TestCases.ReorderTestCases;

/// <summary>Handles <see cref="ReorderTestCasesCommand"/>.</summary>
/// <param name="cases">Test case repository.</param>
/// <param name="audit">Audit trail.</param>
/// <param name="unitOfWork">Unit of work.</param>
/// <param name="worker">Tells open pages about the change.</param>
/// <param name="clock">Clock.</param>
internal sealed class ReorderTestCasesHandler(
    ITestCaseRepository cases,
    IAuditRepository audit,
    IUnitOfWork unitOfWork,
    IWorkerNotifier worker,
    IClock clock) : IRequestHandler<ReorderTestCasesCommand, ReorderTestCasesResponse>
{
    public async Task<ReorderTestCasesResponse> HandleAsync(ReorderTestCasesCommand request, CancellationToken cancellationToken)
    {
        var ids = request.Ids.Distinct(StringComparer.Ordinal).ToList();
        var found = (await cases.FindManyAsync(ids, cancellationToken).ConfigureAwait(false))
            .ToDictionary(c => c.CaseCode, StringComparer.Ordinal);
        var ordered = ids.Where(found.ContainsKey).Select(id => found[id]).ToList();

        // The listed cases swap the sort keys they already hold: every key stays unique, cases left out of the list
        // keep their place, and a case nobody has moved yet holds its Id as its key.
        var keys = ordered.Select(c => c.SortOrder ?? c.Id).Order().ToList();
        var now = clock.UtcNow;
        var changed = 0;
        for (var i = 0; i < ordered.Count; i++)
        {
            if ((ordered[i].SortOrder ?? ordered[i].Id) != keys[i])
            {
                ordered[i].Reorder(keys[i], now);
                changed++;
            }
        }

        if (changed > 0)
        {
            audit.Add(AuditActions.CaseReorder, Text.Count(changed, "test case"), $"Changed the order of {Text.Count(changed, "test case")}.");
            await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            // The order only affects lists and the next run, which reads cases in list order, so pages just refresh.
            await worker.MasterDataChangedAsync(cancellationToken).ConfigureAwait(false);
        }

        return new ReorderTestCasesResponse(changed, ids.Count - ordered.Count);
    }
}
