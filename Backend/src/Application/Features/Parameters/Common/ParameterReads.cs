using System.Globalization;
using QaStudio.Application.Abstractions;
using QaStudio.Core.Common;
using QaStudio.Core.TestCases;

namespace QaStudio.Application.Features.Parameters.Common;

/// <summary>Reads the views the parameter handlers return, from the cases and the stored values.</summary>
/// <param name="cases">Reads the cases and their steps.</param>
/// <param name="store">The parameter values.</param>
internal sealed class ParameterReads(IParameterCaseReader cases, IParameterStore store)
{
    /// <summary>One case's parameters.</summary>
    /// <param name="caseCode">The case ID.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The view. A case that does not exist has no parameters.</returns>
    public async Task<CaseParameters> CaseAsync(string caseCode, CancellationToken cancellationToken)
    {
        var found = await cases.ReadAsync(caseCode, null, cancellationToken).ConfigureAwait(false) is [var first, ..] ? first : null;
        var own = await store.GetCaseAsync(caseCode, cancellationToken).ConfigureAwait(false);
        var common = found?.ProjectId is { } p
            ? (await store.GetProjectsAsync([p], cancellationToken).ConfigureAwait(false)).GetValueOrDefault(p)
            : null;
        return ParameterViews.ForCase(caseCode, found?.ProjectId, ParameterViews.NeededNames(found?.ScenarioJson), own, common ?? new Dictionary<string, string>());
    }

    /// <summary>A project's common values with how many of its cases use and override each.</summary>
    /// <param name="projectId">The project.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The common values.</returns>
    public async Task<CommonParameters> ProjectAsync(int projectId, CancellationToken cancellationToken)
    {
        var inProject = await cases.ReadAsync(null, projectId, cancellationToken).ConfigureAwait(false);
        var own = await store.GetCasesAsync([.. inProject.Select(c => c.Code)], cancellationToken).ConfigureAwait(false);
        var common = (await store.GetProjectsAsync([projectId], cancellationToken).ConfigureAwait(false)).GetValueOrDefault(projectId) ?? new Dictionary<string, string>();
        return ParameterViews.ForProject(projectId, inProject.Select(c => (c.Code, ParameterViews.NeededNames(c.ScenarioJson))), own, common);
    }

    /// <summary>The error for a case that does not exist.</summary>
    /// <param name="caseCode">The case ID.</param>
    /// <returns>The exception.</returns>
    public static NotFoundException UnknownCase(string caseCode) => TestCaseErrors.NotFound(caseCode);

    /// <summary>The project key of a project ID, for the config-style lookups.</summary>
    /// <param name="projectId">The project.</param>
    /// <returns>The key.</returns>
    public static string Key(int projectId) => projectId.ToString(CultureInfo.InvariantCulture);
}
