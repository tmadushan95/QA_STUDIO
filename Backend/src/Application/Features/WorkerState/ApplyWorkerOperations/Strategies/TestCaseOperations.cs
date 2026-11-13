using System.Text.Json;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestCases.Common;
using QaStudio.Core.Common;
using QaStudio.Core.TestCases;

namespace QaStudio.Application.Features.WorkerState.ApplyWorkerOperations.Strategies;

/// <summary>Test case writes coming from the worker (imports, AI, clearing, restoring).</summary>
/// <param name="cases">Test case repository.</param>
/// <param name="resolver">Files cases that arrive without a suite.</param>
/// <param name="clock">Clock.</param>
/// <param name="unitOfWork">Unit of work.</param>
/// <param name="store">The document store, for where a backup's cases were filed.</param>
/// <param name="suites">Suite repository.</param>
/// <param name="versions">Version repository, for the version hint of a new case.</param>
internal sealed class TestCaseOperations(
    ITestCaseRepository cases,
    DefaultSuiteResolver resolver,
    IClock clock,
    IUnitOfWork unitOfWork,
    IWorkerStateStore store,
    ITestSuiteRepository suites,
    IProjectVersionRepository versions) : WorkerOperationHandler
{
    protected override Dictionary<string, Func<WorkerOperation, CancellationToken, Task>> BuildRoutes() => new(StringComparer.Ordinal)
    {
        [WorkerOperationKinds.TestCaseUpsert] = (o, ct) => UpsertAsync(WorkerPayload.Required(o), ct),
        [WorkerOperationKinds.TestCaseDelete] = (o, ct) => DeleteAsync(WorkerPayload.Key(o), ct),
        [WorkerOperationKinds.TestCaseDeleteAll] = (_, ct) => cases.DeleteAllAsync(ct),
        [WorkerOperationKinds.BackupRestored] = (o, ct) => RestoreFilingAsync(WorkerPayload.Key(o), ct),
    };

    private async Task DeleteAsync(string caseCode, CancellationToken cancellationToken)
    {
        var existing = await cases.FindAsync(caseCode, cancellationToken).ConfigureAwait(false);
        if (existing is not null)
        {
            cases.Remove(existing);
            // Saved now so the same batch can write this ID again without two tracked instances.
            await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// The restore just re-created the cases, and with no suite on the worker's copy they were filed by module. This
    /// puts each back where it was, unless that suite has since been deleted.
    /// </summary>
    private async Task RestoreFilingAsync(string backupId, CancellationToken cancellationToken)
    {
        await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        var filing = await store.ReadBackupFilingAsync(backupId, cancellationToken).ConfigureAwait(false);
        if (filing.Count == 0)
        {
            return;
        }

        var existing = new HashSet<int>();
        foreach (var suiteId in filing.Values.Distinct())
        {
            var suite = await suites.FindAsync(suiteId, cancellationToken).ConfigureAwait(false);
            if (suite is not null)
            {
                existing.Add(suiteId);
            }
        }

        var now = clock.UtcNow;
        var found = await cases.FindManyAsync([.. filing.Keys], cancellationToken).ConfigureAwait(false);
        foreach (var testCase in found.Where(c => existing.Contains(filing[c.CaseCode]) && c.TestSuiteId != filing[c.CaseCode]))
        {
            testCase.MoveTo(filing[testCase.CaseCode], now);
        }
    }

    private async Task UpsertAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var doc = payload.Deserialize<WorkerTestCase>(TestCaseMapper.WorkerJson)
            ?? throw new RequestValidationException(ErrorCodes.InvalidOperation, "The test case is missing.");
        if (doc.Source is null)
        {
            throw new RequestValidationException(ErrorCodes.InvalidOperation, "The test case has no source.");
        }

        var content = new TestCaseContent
        {
            Title = doc.Title,
            Description = doc.Description,
            Module = doc.Module,
            Preconditions = doc.Preconditions,
            ExpectedResult = doc.ExpectedResult,
            Priority = doc.Priority,
            Severity = doc.Severity,
            TestType = doc.TestType,
            UserRole = doc.UserRole,
            TagsJson = TestCaseMapper.ToJsonList(doc.Tags),
            DependsOnJson = TestCaseMapper.ToJsonList(doc.DependsOn),
            Readiness = doc.Readiness ?? TestCase.DefaultReadiness,
            Source = new TestCaseSource(doc.Source.Workbook, doc.Source.Worksheet, doc.Source.RowNumber),
        };
        var steps = (doc.Steps ?? []).Select(s => new TestCaseStep(s.Order, s.Action, s.Expected));
        var now = clock.UtcNow;
        var existing = await cases.FindAsync(doc.Id, cancellationToken).ConfigureAwait(false);
        if (existing is not null)
        {
            // Where a case is filed is decided here, not on the worker's copy, so it is left alone.
            existing.Update(content, steps, now);
            return;
        }

        var hinted = doc.TestSuiteId is > 0 ? await suites.FindAsync(doc.TestSuiteId.Value, cancellationToken).ConfigureAwait(false) : null;
        var suite = hinted ?? await resolver.ResolveAsync(doc.Module, doc.ProjectId, cancellationToken).ConfigureAwait(false);
        var created = TestCase.CreateIn(doc.Id, suite, content, steps, now);
        // A version is a release of one project, so the hint counts only when it belongs to the project the case was
        // actually filed in. A suite created just now has no key yet, so its project is read from the navigation.
        var filedProjectId = suite.ProjectId != 0 ? suite.ProjectId : suite.Project.Id;
        if (filedProjectId > 0 && doc.ProjectVersionId is > 0)
        {
            var version = await versions.FindAsync(doc.ProjectVersionId.Value, cancellationToken).ConfigureAwait(false);
            if (version is not null && version.ProjectId == filedProjectId)
            {
                created.AssignVersion(version.Id, now);
            }
        }

        cases.Add(created);
    }
}
