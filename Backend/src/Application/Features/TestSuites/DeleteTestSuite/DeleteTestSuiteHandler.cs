using System.Globalization;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;
using QaStudio.Core.Common;
using QaStudio.Core.MasterData;

namespace QaStudio.Application.Features.TestSuites.DeleteTestSuite;

/// <summary>Handles <see cref="DeleteTestSuiteCommand"/>.</summary>
/// <param name="suites">Suite repository.</param>
/// <param name="cases">Test case counts.</param>
/// <param name="audit">Audit trail.</param>
/// <param name="commit">Commits and announces the change.</param>
internal sealed class DeleteTestSuiteHandler(
    ITestSuiteRepository suites,
    ITestCaseReader cases,
    IAuditRepository audit,
    MasterDataCommit commit) : IRequestHandler<DeleteTestSuiteCommand, Unit>
{
    public async Task<Unit> HandleAsync(DeleteTestSuiteCommand request, CancellationToken cancellationToken)
    {
        var suite = await suites.FindAsync(request.Id, cancellationToken).ConfigureAwait(false)
            ?? throw TestSuiteErrors.NotFound();
        var counts = await cases.CountBySuiteAsync(cancellationToken).ConfigureAwait(false);
        suite.EnsureCanBeDeleted(counts.GetValueOrDefault(suite.Id));
        suites.Remove(suite);
        audit.Add(AuditActions.SuiteDelete, suite.Id.ToString(CultureInfo.InvariantCulture), $"Test suite \"{suite.Name}\" deleted.");
        await commit.SaveAndAnnounceAsync(cancellationToken).ConfigureAwait(false);
        return Unit.Value;
    }
}
