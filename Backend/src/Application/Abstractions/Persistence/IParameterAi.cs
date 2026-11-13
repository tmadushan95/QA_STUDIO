namespace QaStudio.Application.Abstractions;

/// <summary>Asks the AI for realistic values of parameter names. Only the worker can talk to the AI.</summary>
public interface IParameterAi
{
    /// <summary>Values for the names, or none when the AI is off, unreachable or answers badly. Never throws for those.</summary>
    /// <param name="title">The case's title.</param>
    /// <param name="steps">The case's written steps.</param>
    /// <param name="names">The parameter names to fill.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>Name to suggested value; names it had no answer for are absent.</returns>
    Task<IReadOnlyDictionary<string, string>> SuggestAsync(string title, IReadOnlyList<string> steps, IReadOnlyList<string> names, CancellationToken cancellationToken);
}
