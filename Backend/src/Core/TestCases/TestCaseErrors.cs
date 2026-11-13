using QaStudio.Core.Common;

namespace QaStudio.Core.TestCases;

/// <summary>The failures a test case can report.</summary>
public static class TestCaseErrors
{
    /// <summary>There is no such test case.</summary>
    /// <param name="caseCode">The case ID.</param>
    /// <returns>The exception.</returns>
    public static NotFoundException NotFound(string caseCode) =>
        new(ErrorCodes.UnknownCase, $"There is no test case \"{caseCode}\".");

    /// <summary>A case ID is already in use.</summary>
    /// <param name="caseCode">The case ID.</param>
    /// <returns>The exception.</returns>
    public static ConflictException DuplicateId(string caseCode) =>
        new(
            ErrorCodes.DuplicateId,
            $"There is already a test case \"{caseCode}\".",
            new Dictionary<string, string>(StringComparer.Ordinal) { [FieldNames.Id] = "This ID is already used." });
}
