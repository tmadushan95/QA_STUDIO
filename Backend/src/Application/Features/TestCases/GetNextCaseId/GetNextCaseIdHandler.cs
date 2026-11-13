using QaStudio.Application.Abstractions;
using QaStudio.Core.TestCases;

namespace QaStudio.Application.Features.TestCases.GetNextCaseId;

/// <summary>Handles <see cref="GetNextCaseIdQuery"/>.</summary>
/// <param name="cases">Test case repository.</param>
internal sealed class GetNextCaseIdHandler(ITestCaseRepository cases) : IRequestHandler<GetNextCaseIdQuery, GetNextCaseIdResponse>
{
    public async Task<GetNextCaseIdResponse> HandleAsync(GetNextCaseIdQuery request, CancellationToken cancellationToken) =>
        new(CaseCodeGenerator.Next(await cases.ListCodesAsync(cancellationToken).ConfigureAwait(false)));
}
