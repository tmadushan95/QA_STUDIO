using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestSuites.Common;

namespace QaStudio.Application.Features.TestSuites.GetTestSuite;

/// <summary>Gets one suite.</summary>
/// <param name="Id">The key.</param>
public sealed record GetTestSuiteQuery(int Id) : IQuery<TestSuiteResponse>;
