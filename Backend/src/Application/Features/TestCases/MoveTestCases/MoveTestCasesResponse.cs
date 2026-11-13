namespace QaStudio.Application.Features.TestCases.MoveTestCases;

/// <summary>Outcome of a move.</summary>
/// <param name="Moved">How many moved.</param>
/// <param name="NotFound">How many did not exist.</param>
public sealed record MoveTestCasesResponse(int Moved, int NotFound);
