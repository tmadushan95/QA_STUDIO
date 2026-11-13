using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestCases.Common;
using QaStudio.Core.Common;
using QaStudio.Core.MasterData;
using QaStudio.Core.TestCases;

namespace QaStudio.Application.Features.TestCases.CreateTestCase;

/// <summary>Handles <see cref="CreateTestCaseCommand"/>.</summary>
/// <param name="cases">Test case repository.</param>
/// <param name="suites">Suite repository.</param>
/// <param name="versions">Version repository.</param>
/// <param name="audit">Audit trail.</param>
/// <param name="commit">Commits and announces the case.</param>
/// <param name="clock">Clock.</param>
internal sealed class CreateTestCaseHandler(
    ITestCaseRepository cases,
    ITestSuiteRepository suites,
    IProjectVersionRepository versions,
    IAuditRepository audit,
    TestCaseCommit commit,
    IClock clock) : IRequestHandler<CreateTestCaseCommand, TestCaseResponse>
{
    public async Task<TestCaseResponse> HandleAsync(CreateTestCaseCommand request, CancellationToken cancellationToken)
    {
        var suite = await suites.FindAsync(request.TestSuiteId, cancellationToken).ConfigureAwait(false)
            ?? throw TestSuiteErrors.NoLongerSelectable();
        var custom = Text.OrNull(request.Id);
        if (custom is not null && await cases.ExistsAsync(custom, cancellationToken).ConfigureAwait(false))
        {
            throw TestCaseErrors.DuplicateId(custom);
        }

        var id = custom ?? CaseCodeGenerator.Next(await cases.ListCodesAsync(cancellationToken).ConfigureAwait(false));
        var content = request.Input.ToContent(TestCaseSource.CreatedInApp, TestCaseContent.EmptyJsonList, TestCase.DefaultReadiness);
        var created = TestCase.Create(id, suite.Id, content, request.Input.ToSteps(), clock.UtcNow);
        if (request.ProjectVersionId is { } versionId)
        {
            // A version is a release of one project: it must be the suite's project, checked here so the case and its
            // version are saved together or not at all.
            var version = await versions.FindAsync(versionId, cancellationToken).ConfigureAwait(false)
                ?? throw ProjectVersionErrors.NotFound();
            if (version.ProjectId != suite.ProjectId)
            {
                throw ProjectVersionErrors.OtherProject(id);
            }

            created.AssignVersion(version.Id, clock.UtcNow);
        }

        cases.Add(created);
        audit.Add(AuditActions.CaseCreate, id, "Test case created in the app.");
        return await commit.SaveAndAnnounceAsync(id, cancellationToken).ConfigureAwait(false);
    }
}
