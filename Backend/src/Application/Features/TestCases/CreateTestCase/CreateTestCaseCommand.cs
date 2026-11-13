using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestCases.Common;

namespace QaStudio.Application.Features.TestCases.CreateTestCase;

/// <summary>Creates a test case in a suite.</summary>
/// <param name="Id">The case ID; left out, the next free one is assigned.</param>
/// <param name="TestSuiteId">The suite to file it under.</param>
/// <param name="Input">The written content.</param>
/// <param name="ProjectVersionId">The project version it is written for; must belong to the suite's project.</param>
public sealed record CreateTestCaseCommand(string? Id, int TestSuiteId, TestCaseInput Input, int? ProjectVersionId = null) : ICommand<TestCaseResponse>;
