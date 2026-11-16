namespace QaStudio.Application.Features.TestCases.ReorderTestCases;

/// <summary>Outcome of a reorder.</summary>
/// <param name="Reordered">How many cases changed place.</param>
/// <param name="NotFound">How many did not exist.</param>
public sealed record ReorderTestCasesResponse(int Reordered, int NotFound);
