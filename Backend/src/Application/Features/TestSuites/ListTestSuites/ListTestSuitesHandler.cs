using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestSuites.Common;

namespace QaStudio.Application.Features.TestSuites.ListTestSuites;

/// <summary>Handles <see cref="ListTestSuitesQuery"/>.</summary>
/// <param name="responses">Builds responses.</param>
internal sealed class ListTestSuitesHandler(TestSuiteResponseBuilder responses)
    : IRequestHandler<ListTestSuitesQuery, IReadOnlyList<TestSuiteResponse>>
{
    public Task<IReadOnlyList<TestSuiteResponse>> HandleAsync(ListTestSuitesQuery request, CancellationToken cancellationToken) =>
        responses.BuildAllAsync(request.ProjectId, cancellationToken);
}
