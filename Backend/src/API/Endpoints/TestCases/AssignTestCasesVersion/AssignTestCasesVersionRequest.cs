namespace QaStudio.Api.Endpoints.TestCases.AssignTestCasesVersion;

/// <summary>The body of a version assignment.</summary>
/// <param name="Ids">The case IDs.</param>
/// <param name="ProjectVersionId">The version, or null to clear it.</param>
public sealed record AssignTestCasesVersionRequest(IReadOnlyList<string> Ids, int? ProjectVersionId);
