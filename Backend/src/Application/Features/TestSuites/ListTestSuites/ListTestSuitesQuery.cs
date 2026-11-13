using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestSuites.Common;

namespace QaStudio.Application.Features.TestSuites.ListTestSuites;

/// <summary>Lists test suites.</summary>
/// <param name="ProjectId">Only this project's suites, when given.</param>
public sealed record ListTestSuitesQuery(int? ProjectId) : IQuery<IReadOnlyList<TestSuiteResponse>>;
