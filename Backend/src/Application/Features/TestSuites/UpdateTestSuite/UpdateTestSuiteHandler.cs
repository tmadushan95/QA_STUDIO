using System.Globalization;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;
using QaStudio.Application.Features.TestSuites.Common;
using QaStudio.Core.Common;
using QaStudio.Core.MasterData;

namespace QaStudio.Application.Features.TestSuites.UpdateTestSuite;

/// <summary>Handles <see cref="UpdateTestSuiteCommand"/>.</summary>
/// <param name="suites">Suite repository.</param>
/// <param name="responses">Builds responses.</param>
/// <param name="audit">Audit trail.</param>
/// <param name="commit">Commits and announces the change.</param>
/// <param name="clock">Clock.</param>
internal sealed class UpdateTestSuiteHandler(
    ITestSuiteRepository suites,
    TestSuiteResponseBuilder responses,
    IAuditRepository audit,
    MasterDataCommit commit,
    IClock clock) : IRequestHandler<UpdateTestSuiteCommand, TestSuiteResponse>
{
    public async Task<TestSuiteResponse> HandleAsync(UpdateTestSuiteCommand request, CancellationToken cancellationToken)
    {
        var suite = await suites.FindAsync(request.Id, cancellationToken).ConfigureAwait(false)
            ?? throw TestSuiteErrors.NotFound();
        var name = Text.OrEmpty(request.Name);
        if (!string.Equals(suite.Name, name, StringComparison.OrdinalIgnoreCase)
            && await suites.FindByNameAsync(suite.ProjectId, name, cancellationToken).ConfigureAwait(false) is not null)
        {
            throw TestSuiteErrors.DuplicateName(name, "This project");
        }

        suites.ExpectVersionIfGiven(suite, request.RowVersion);
        suite.Update(name, request.Description, request.SortOrder, request.IsActive, clock.UtcNow);
        audit.Add(AuditActions.SuiteUpdate, suite.Id.ToString(CultureInfo.InvariantCulture), $"Test suite \"{name}\" updated.");
        await commit.SaveAndAnnounceAsync(cancellationToken).ConfigureAwait(false);
        return await responses.BuildAsync(suite.Id, cancellationToken).ConfigureAwait(false);
    }
}
