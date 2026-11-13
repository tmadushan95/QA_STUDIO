namespace QaStudio.Application.Features.TestCases.AssignTestCasesVersion;

/// <summary>Outcome of a version assignment.</summary>
/// <param name="Assigned">How many cases changed.</param>
/// <param name="NotFound">How many did not exist.</param>
public sealed record AssignTestCasesVersionResponse(int Assigned, int NotFound);
