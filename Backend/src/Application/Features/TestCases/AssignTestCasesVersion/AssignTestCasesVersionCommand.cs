using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Features.TestCases.AssignTestCasesVersion;

/// <summary>Gives test cases a project version, or clears it.</summary>
/// <param name="Ids">The case IDs.</param>
/// <param name="ProjectVersionId">The version, or null to clear.</param>
public sealed record AssignTestCasesVersionCommand(IReadOnlyList<string> Ids, int? ProjectVersionId) : ICommand<AssignTestCasesVersionResponse>;
