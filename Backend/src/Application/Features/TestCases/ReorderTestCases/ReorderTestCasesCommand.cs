using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Features.TestCases.ReorderTestCases;

/// <summary>
/// Puts test cases in a new order. Only the listed cases move, and only among the places they already hold, so a
/// filtered list can be reordered without disturbing the cases it hides.
/// </summary>
/// <param name="Ids">The case IDs, in their new order.</param>
public sealed record ReorderTestCasesCommand(IReadOnlyList<string> Ids) : ICommand<ReorderTestCasesResponse>;
