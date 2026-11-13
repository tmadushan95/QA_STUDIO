using QaStudio.Application.Abstractions;
using QaStudio.Core.Common;

namespace QaStudio.Application.Features.TestCases.DeleteTestCases;

/// <summary>Handles <see cref="DeleteTestCasesCommand"/>.</summary>
/// <param name="cases">Test case repository.</param>
/// <param name="parameters">Parameter values, removed with the case.</param>
/// <param name="audit">Audit trail.</param>
/// <param name="unitOfWork">Unit of work.</param>
/// <param name="worker">Tells the worker about the change.</param>
internal sealed class DeleteTestCasesHandler(
    ITestCaseRepository cases,
    IParameterStore parameters,
    IAuditRepository audit,
    IUnitOfWork unitOfWork,
    IWorkerNotifier worker) : IRequestHandler<DeleteTestCasesCommand, DeleteTestCasesResponse>
{
    public async Task<DeleteTestCasesResponse> HandleAsync(DeleteTestCasesCommand request, CancellationToken cancellationToken)
    {
        var ids = request.Ids.Distinct(StringComparer.Ordinal).ToList();
        var found = await cases.FindManyAsync(ids, cancellationToken).ConfigureAwait(false);
        foreach (var testCase in found)
        {
            cases.Remove(testCase);
        }

        if (found.Count > 0)
        {
            // A deleted case leaves no parameter values behind.
            await parameters.DeleteCasesAsync([.. found.Select(c => c.CaseCode)], cancellationToken).ConfigureAwait(false);
            audit.Add(AuditActions.CaseDelete, "test cases", $"Removed {Text.Count(found.Count, "test case")}.");
            await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            await worker.TestCasesChangedAsync([], [.. found.Select(c => c.CaseCode)], cancellationToken).ConfigureAwait(false);
        }

        return new DeleteTestCasesResponse(found.Count, ids.Count - found.Count);
    }
}
