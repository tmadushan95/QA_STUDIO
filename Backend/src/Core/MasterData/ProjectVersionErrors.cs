using QaStudio.Core.Common;

namespace QaStudio.Core.MasterData;

/// <summary>The failures a project version can report.</summary>
public static class ProjectVersionErrors
{
    /// <summary>There is no such version.</summary>
    /// <returns>The exception.</returns>
    public static NotFoundException NotFound() => new(ErrorCodes.UnknownVersion, "There is no such project version.");

    /// <summary>A name is already in use within a project.</summary>
    /// <param name="name">The version name.</param>
    /// <param name="project">The project, as it should read in the message.</param>
    /// <returns>The exception.</returns>
    public static ConflictException DuplicateName(string name, string project) =>
        new(
            ErrorCodes.DuplicateVersion,
            $"\"{project}\" already has a version called \"{name}\".",
            new Dictionary<string, string>(StringComparer.Ordinal) { [FieldNames.Name] = "This version already exists in the project." });

    /// <summary>A case was assigned a version of a project other than its own.</summary>
    /// <param name="caseCode">The case ID.</param>
    /// <returns>The exception.</returns>
    public static RequestValidationException OtherProject(string caseCode) =>
        new(
            ErrorCodes.VersionProjectMismatch,
            $"{caseCode} belongs to another project. A version can only be given to its own project's test cases.",
            new Dictionary<string, string>(StringComparer.Ordinal) { [FieldNames.ProjectVersionId] = "Choose a version of the case's project." });
}
