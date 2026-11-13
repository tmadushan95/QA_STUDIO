using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestCases.Common;

namespace QaStudio.Application.Features.TestCases.GetTestCase;

/// <summary>Gets one test case.</summary>
/// <param name="CaseId">The case ID.</param>
public sealed record GetTestCaseQuery(string CaseId) : IQuery<TestCaseResponse>;
