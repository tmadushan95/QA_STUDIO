using Microsoft.Extensions.Options;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;
using QaStudio.Application.Features.TestCases.Common;
using QaStudio.Core.Common;

namespace QaStudio.Application.Features.TestCases.ListTestCases;

/// <summary>Handles <see cref="ListTestCasesQuery"/>.</summary>
/// <param name="reader">Test case queries.</param>
/// <param name="limits">Request limits.</param>
internal sealed class ListTestCasesHandler(ITestCaseReader reader, IOptions<LimitsOptions> limits)
    : IRequestHandler<ListTestCasesQuery, ListTestCasesResponse>
{
    public async Task<ListTestCasesResponse> HandleAsync(ListTestCasesQuery request, CancellationToken cancellationToken)
    {
        var page = Math.Max(1, request.Page);
        var size = Math.Clamp(request.PageSize, 1, limits.Value.MaxPageSize);
        var filter = new TestCaseFilter(
            request.ProjectId,
            request.TestSuiteId,
            request.ProjectVersionId,
            Text.OrNull(request.Search),
            Text.OrNull(request.Module),
            Text.OrNull(request.Priority),
            page,
            size);
        var (items, total) = await reader.ListAsync(filter, cancellationToken).ConfigureAwait(false);
        return new ListTestCasesResponse(total, page, size, [.. items.Select(TestCaseMapper.ToResponse)]);
    }
}
