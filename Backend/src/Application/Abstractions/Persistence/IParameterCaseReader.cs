namespace QaStudio.Application.Abstractions;

/// <summary>A test case with the steps its parameters are read from.</summary>
/// <param name="Code">The case ID.</param>
/// <param name="ProjectId">The project the case is filed under.</param>
/// <param name="ScenarioJson">The stored scenario record the steps come from: the draft when there is one, else the approved one.</param>
public sealed record ParameterCase(string Code, int? ProjectId, string? ScenarioJson);

/// <summary>A case's title and written steps.</summary>
/// <param name="Title">The title.</param>
/// <param name="Steps">The written steps, in order.</param>
public sealed record ParameterCaseContext(string Title, IReadOnlyList<string> Steps);

/// <summary>Reads the cases whose parameters are shown.</summary>
public interface IParameterCaseReader
{
    /// <summary>Reads cases with their steps, optionally one case or one project's cases.</summary>
    /// <param name="caseCode">Only this case, when given.</param>
    /// <param name="projectId">Only this project's cases, when given.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The cases, in library order.</returns>
    Task<IReadOnlyList<ParameterCase>> ReadAsync(string? caseCode, int? projectId, CancellationToken cancellationToken);

    /// <summary>Reads a case's title and written steps, which the AI is shown to suggest values.</summary>
    /// <param name="caseCode">The case ID.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The context, or null when there is no such case.</returns>
    Task<ParameterCaseContext?> ReadContextAsync(string caseCode, CancellationToken cancellationToken);

    /// <summary>Reads the project each of the given cases is filed under.</summary>
    /// <param name="caseCodes">The case IDs.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>Case to project; a case that does not exist is absent.</returns>
    Task<IReadOnlyDictionary<string, int>> ReadProjectsAsync(IReadOnlyCollection<string> caseCodes, CancellationToken cancellationToken);
}
