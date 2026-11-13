using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestCases.Common;

namespace QaStudio.Application.Features.WorkerState.GetWorkerTestCases;

/// <summary>Reads every test case in the worker's shape, for a refresh before a run starts.</summary>
public sealed record GetWorkerTestCasesQuery : IQuery<IReadOnlyList<TestCaseResponse>>;
