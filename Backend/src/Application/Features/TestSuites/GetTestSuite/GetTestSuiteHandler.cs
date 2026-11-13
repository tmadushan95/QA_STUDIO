using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestSuites.Common;

namespace QaStudio.Application.Features.TestSuites.GetTestSuite;

/// <summary>Handles <see cref="GetTestSuiteQuery"/>.</summary>
/// <param name="responses">Builds responses.</param>
internal sealed class GetTestSuiteHandler(TestSuiteResponseBuilder responses) : IRequestHandler<GetTestSuiteQuery, TestSuiteResponse>
{
    public Task<TestSuiteResponse> HandleAsync(GetTestSuiteQuery request, CancellationToken cancellationToken) =>
        responses.BuildAsync(request.Id, cancellationToken);
}
