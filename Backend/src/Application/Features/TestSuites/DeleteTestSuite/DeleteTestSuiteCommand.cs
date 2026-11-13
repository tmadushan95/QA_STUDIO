using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;

namespace QaStudio.Application.Features.TestSuites.DeleteTestSuite;

/// <summary>Deletes a suite that holds no test cases.</summary>
/// <param name="Id">The key.</param>
public sealed record DeleteTestSuiteCommand(int Id) : ICommand<Unit>;
