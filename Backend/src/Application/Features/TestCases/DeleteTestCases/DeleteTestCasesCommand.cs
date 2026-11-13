using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Features.TestCases.DeleteTestCases;

/// <summary>Deletes test cases.</summary>
/// <param name="Ids">The case IDs.</param>
public sealed record DeleteTestCasesCommand(IReadOnlyList<string> Ids) : ICommand<DeleteTestCasesResponse>;
