namespace QaStudio.Application.Abstractions;

/// <summary>
/// The parameter values: what each test case sets for itself, and what each project shares. A value is never empty; clearing a
/// value removes it. Changes are staged and committed by the unit of work, except clearing everything.
/// </summary>
public interface IParameterStore
{
    /// <summary>One case's own values.</summary>
    /// <param name="caseCode">The case ID.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>Name to value.</returns>
    Task<IReadOnlyDictionary<string, string>> GetCaseAsync(string caseCode, CancellationToken cancellationToken);

    /// <summary>Own values of many cases, or of every case.</summary>
    /// <param name="caseCodes">The cases, or null for all.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>Case to name to value; a case with none is absent.</returns>
    Task<IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>> GetCasesAsync(IReadOnlyCollection<string>? caseCodes, CancellationToken cancellationToken);

    /// <summary>Common values of some projects, or of every project.</summary>
    /// <param name="projectIds">The projects, or null for all.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>Project to name to value; a project with none is absent.</returns>
    Task<IReadOnlyDictionary<int, IReadOnlyDictionary<string, string>>> GetProjectsAsync(IReadOnlyCollection<int>? projectIds, CancellationToken cancellationToken);

    /// <summary>Stages replacing all of one case's own values.</summary>
    /// <param name="caseCode">The case ID.</param>
    /// <param name="values">The new values (non-empty).</param>
    /// <param name="atUtc">When it is saved.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when the change is staged.</returns>
    Task ReplaceCaseAsync(string caseCode, IReadOnlyDictionary<string, string> values, DateTime atUtc, CancellationToken cancellationToken);

    /// <summary>Stages replacing all of one project's common values.</summary>
    /// <param name="projectId">The project.</param>
    /// <param name="values">The new values (non-empty).</param>
    /// <param name="atUtc">When it is saved.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when the change is staged.</returns>
    Task ReplaceProjectAsync(int projectId, IReadOnlyDictionary<string, string> values, DateTime atUtc, CancellationToken cancellationToken);

    /// <summary>Stages removing the values of the given cases.</summary>
    /// <param name="caseCodes">The cases.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>A task that completes when the change is staged.</returns>
    Task DeleteCasesAsync(IReadOnlyCollection<string> caseCodes, CancellationToken cancellationToken);

    /// <summary>Removes every case's own values at once (project common values are kept).</summary>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>How many cases had values.</returns>
    Task<int> DeleteAllCasesAsync(CancellationToken cancellationToken);
}
