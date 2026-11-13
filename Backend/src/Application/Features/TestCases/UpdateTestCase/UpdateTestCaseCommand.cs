using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestCases.Common;

namespace QaStudio.Application.Features.TestCases.UpdateTestCase;

/// <summary>Replaces a test case's written content, and files it under another suite when one is given.</summary>
/// <param name="CaseId">The case ID.</param>
/// <param name="TestSuiteId">The suite to file it under.</param>
/// <param name="Input">The written content.</param>
/// <param name="RowVersion">The version the editor opened.</param>
public sealed record UpdateTestCaseCommand(string CaseId, int TestSuiteId, TestCaseInput Input, string? RowVersion) : ICommand<TestCaseResponse>;
