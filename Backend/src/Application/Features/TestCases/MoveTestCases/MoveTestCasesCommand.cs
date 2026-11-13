using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Features.TestCases.MoveTestCases;

/// <summary>Files test cases under another suite.</summary>
/// <param name="Ids">The case IDs.</param>
/// <param name="TestSuiteId">The target suite.</param>
public sealed record MoveTestCasesCommand(IReadOnlyList<string> Ids, int TestSuiteId) : ICommand<MoveTestCasesResponse>;
