using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestCases.Common;
using QaStudio.Core.TestCases;

namespace QaStudio.Application.Features.TestCases.GetTestCase;

/// <summary>Handles <see cref="GetTestCaseQuery"/>.</summary>
/// <param name="reader">Test case queries.</param>
internal sealed class GetTestCaseHandler(ITestCaseReader reader) : IRequestHandler<GetTestCaseQuery, TestCaseResponse>
{
    public async Task<TestCaseResponse> HandleAsync(GetTestCaseQuery request, CancellationToken cancellationToken)
    {
        var model = await reader.GetAsync(request.CaseId, cancellationToken).ConfigureAwait(false)
            ?? throw TestCaseErrors.NotFound(request.CaseId);
        return TestCaseMapper.ToResponse(model);
    }
}
