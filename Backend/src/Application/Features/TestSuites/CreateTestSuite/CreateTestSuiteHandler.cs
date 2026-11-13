using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;
using QaStudio.Application.Features.TestSuites.Common;
using QaStudio.Core.Common;
using QaStudio.Core.MasterData;

namespace QaStudio.Application.Features.TestSuites.CreateTestSuite;

/// <summary>Handles <see cref="CreateTestSuiteCommand"/>.</summary>
/// <param name="projects">Project repository.</param>
/// <param name="suites">Suite repository.</param>
/// <param name="responses">Builds responses.</param>
/// <param name="audit">Audit trail.</param>
/// <param name="commit">Commits and announces the change.</param>
/// <param name="clock">Clock.</param>
internal sealed class CreateTestSuiteHandler(
    IProjectRepository projects,
    ITestSuiteRepository suites,
    TestSuiteResponseBuilder responses,
    IAuditRepository audit,
    MasterDataCommit commit,
    IClock clock) : IRequestHandler<CreateTestSuiteCommand, TestSuiteResponse>
{
    public async Task<TestSuiteResponse> HandleAsync(CreateTestSuiteCommand request, CancellationToken cancellationToken)
    {
        var project = await projects.FindAsync(request.ProjectId, cancellationToken).ConfigureAwait(false)
            ?? throw ProjectErrors.NotFound();
        var suite = TestSuite.Create(project.Id, request.Name, request.Description, request.SortOrder, clock.UtcNow);
        if (await suites.FindByNameAsync(project.Id, suite.Name, cancellationToken).ConfigureAwait(false) is not null)
        {
            throw TestSuiteErrors.DuplicateName(suite.Name, project.Name);
        }

        suites.Add(suite);
        audit.Add(AuditActions.SuiteCreate, project.Code, $"Test suite \"{suite.Name}\" created.");
        await commit.SaveAndAnnounceAsync(cancellationToken).ConfigureAwait(false);
        return await responses.BuildAsync(suite.Id, cancellationToken).ConfigureAwait(false);
    }
}
