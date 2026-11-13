using QaStudio.Core.Common;

namespace QaStudio.Core.MasterData;

/// <summary>The failures a test suite can report.</summary>
public static class TestSuiteErrors
{
    /// <summary>What to ask of a person who has not chosen a suite.</summary>
    public const string ChooseSuiteMessage = "Choose a test suite.";

    private const string NoLongerExistsMessage = "That test suite no longer exists.";

    /// <summary>There is no such suite.</summary>
    /// <returns>The exception.</returns>
    public static NotFoundException NotFound() => new(ErrorCodes.UnknownSuite, "There is no such test suite.");

    /// <summary>The suite chosen as a destination has since been deleted.</summary>
    /// <returns>The exception.</returns>
    public static NotFoundException NoLongerExists() => new(ErrorCodes.UnknownSuite, NoLongerExistsMessage);

    /// <summary>The suite chosen on a form has since been deleted, so the form's field is what needs changing.</summary>
    /// <returns>The exception.</returns>
    public static RequestValidationException NoLongerSelectable() =>
        new(
            ErrorCodes.UnknownSuite,
            NoLongerExistsMessage,
            new Dictionary<string, string>(StringComparer.Ordinal) { [FieldNames.TestSuiteId] = ChooseSuiteMessage });

    /// <summary>A name is already in use within a project.</summary>
    /// <param name="name">The suite name.</param>
    /// <param name="project">The project, as it should read in the message.</param>
    /// <returns>The exception.</returns>
    public static ConflictException DuplicateName(string name, string project) =>
        new(
            ErrorCodes.DuplicateSuite,
            $"\"{project}\" already has a test suite called \"{name}\".",
            new Dictionary<string, string>(StringComparer.Ordinal) { [FieldNames.Name] = "This name is already used in the project." });
}
