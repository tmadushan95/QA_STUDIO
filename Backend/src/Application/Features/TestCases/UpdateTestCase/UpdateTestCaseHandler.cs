using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;
using QaStudio.Application.Features.TestCases.Common;
using QaStudio.Core.Common;
using QaStudio.Core.MasterData;
using QaStudio.Core.TestCases;

namespace QaStudio.Application.Features.TestCases.UpdateTestCase;

/// <summary>Handles <see cref="UpdateTestCaseCommand"/>.</summary>
/// <param name="cases">Test case repository.</param>
/// <param name="suites">Suite repository.</param>
/// <param name="audit">Audit trail.</param>
/// <param name="commit">Commits and announces the case.</param>
/// <param name="clock">Clock.</param>
internal sealed class UpdateTestCaseHandler(
    ITestCaseRepository cases,
    ITestSuiteRepository suites,
    IAuditRepository audit,
    TestCaseCommit commit,
    IClock clock) : IRequestHandler<UpdateTestCaseCommand, TestCaseResponse>
{
    public async Task<TestCaseResponse> HandleAsync(UpdateTestCaseCommand request, CancellationToken cancellationToken)
    {
        var testCase = await cases.FindAsync(request.CaseId, cancellationToken).ConfigureAwait(false)
            ?? throw TestCaseErrors.NotFound(request.CaseId);
        if (await suites.FindAsync(request.TestSuiteId, cancellationToken).ConfigureAwait(false) is null)
        {
            throw TestSuiteErrors.NoLongerSelectable();
        }

        cases.ExpectVersionIfGiven(testCase, request.RowVersion);

        // Traceability, prerequisites and readiness are not editable here, so they keep their stored values.
        var source = new TestCaseSource(testCase.SourceWorkbook, testCase.SourceWorksheet, testCase.SourceRowNumber);
        var now = clock.UtcNow;
        // Steps left out of the request are kept, including their expected results, which the request form cannot carry.
        var steps = request.Input.Steps is null
            ? testCase.Steps.Select(s => new TestCaseStep(s.StepOrder, s.Action, s.Expected)).ToList()
            : request.Input.ToSteps().ToList();
        testCase.Update(request.Input.ToContent(source, testCase.DependsOnJson, testCase.Readiness), steps, now);
        testCase.MoveTo(request.TestSuiteId, now);
        audit.Add(AuditActions.CaseUpdate, testCase.CaseCode, "Test case updated.");
        return await commit.SaveAndAnnounceAsync(testCase.CaseCode, cancellationToken).ConfigureAwait(false);
    }
}
