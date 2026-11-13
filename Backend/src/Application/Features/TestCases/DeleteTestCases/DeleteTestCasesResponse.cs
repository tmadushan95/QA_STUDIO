namespace QaStudio.Application.Features.TestCases.DeleteTestCases;

/// <summary>Outcome of a delete.</summary>
/// <param name="Deleted">How many went.</param>
/// <param name="NotFound">How many did not exist.</param>
public sealed record DeleteTestCasesResponse(int Deleted, int NotFound);
