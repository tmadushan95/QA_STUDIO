using QaStudio.Application.Abstractions;
using QaStudio.Core.Common;
using QaStudio.Core.MasterData;

namespace QaStudio.Application.Features.TestCases.AssignTestCasesVersion;

/// <summary>Handles <see cref="AssignTestCasesVersionCommand"/>.</summary>
/// <param name="cases">Test case repository.</param>
/// <param name="versions">Version repository.</param>
/// <param name="suites">Suite repository, to find each case's project.</param>
/// <param name="audit">Audit trail.</param>
/// <param name="unitOfWork">Unit of work.</param>
/// <param name="worker">Tells open pages about the change.</param>
/// <param name="clock">Clock.</param>
internal sealed class AssignTestCasesVersionHandler(
    ITestCaseRepository cases,
    IProjectVersionRepository versions,
    ITestSuiteRepository suites,
    IAuditRepository audit,
    IUnitOfWork unitOfWork,
    IWorkerNotifier worker,
    IClock clock) : IRequestHandler<AssignTestCasesVersionCommand, AssignTestCasesVersionResponse>
{
    public async Task<AssignTestCasesVersionResponse> HandleAsync(AssignTestCasesVersionCommand request, CancellationToken cancellationToken)
    {
        ProjectVersion? version = null;
        if (request.ProjectVersionId is { } versionId)
        {
            version = await versions.FindAsync(versionId, cancellationToken).ConfigureAwait(false)
                ?? throw ProjectVersionErrors.NotFound();
        }

        var ids = request.Ids.Distinct(StringComparer.Ordinal).ToList();
        var found = await cases.FindManyAsync(ids, cancellationToken).ConfigureAwait(false);
        if (version is not null)
        {
            // A version is a release of one project: filing another project's case under it would mislabel the case.
            var projectBySuite = new Dictionary<int, int>();
            foreach (var testCase in found)
            {
                if (!projectBySuite.TryGetValue(testCase.TestSuiteId, out var projectId))
                {
                    var suite = await suites.FindAsync(testCase.TestSuiteId, cancellationToken).ConfigureAwait(false);
                    projectId = suite?.ProjectId ?? 0;
                    projectBySuite[testCase.TestSuiteId] = projectId;
                }

                if (projectId != version.ProjectId)
                {
                    throw ProjectVersionErrors.OtherProject(testCase.CaseCode);
                }
            }
        }

        var now = clock.UtcNow;
        foreach (var testCase in found)
        {
            testCase.AssignVersion(version?.Id, now);
        }

        if (found.Count > 0)
        {
            var label = version is null ? "no version" : $"version \"{version.Name}\"";
            audit.Add(AuditActions.CaseAssignVersion, version?.Name ?? "-", $"Gave {Text.Count(found.Count, "test case")} {label}.");
            await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            await worker.MasterDataChangedAsync(cancellationToken).ConfigureAwait(false);
        }

        return new AssignTestCasesVersionResponse(found.Count, ids.Count - found.Count);
    }
}
