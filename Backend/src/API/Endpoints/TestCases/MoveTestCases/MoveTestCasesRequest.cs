namespace QaStudio.Api.Endpoints.TestCases.MoveTestCases;

/// <summary>The body of a move request.</summary>
/// <param name="Ids">The case IDs.</param>
/// <param name="TestSuiteId">The target suite.</param>
public sealed record MoveTestCasesRequest(IReadOnlyList<string> Ids, int TestSuiteId);
