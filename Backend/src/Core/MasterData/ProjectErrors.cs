using QaStudio.Core.Common;

namespace QaStudio.Core.MasterData;

/// <summary>The failures a project can report.</summary>
public static class ProjectErrors
{
    /// <summary>There is no such project.</summary>
    /// <returns>The exception.</returns>
    public static NotFoundException NotFound() => new(ErrorCodes.UnknownProject, "There is no such project.");

    /// <summary>A code is already in use.</summary>
    /// <param name="code">The code.</param>
    /// <returns>The exception.</returns>
    public static ConflictException DuplicateCode(string code) =>
        new(
            ErrorCodes.DuplicateCode,
            $"There is already a project with the code \"{code}\".",
            new Dictionary<string, string>(StringComparer.Ordinal) { [FieldNames.Code] = "This code is already used." });
}
