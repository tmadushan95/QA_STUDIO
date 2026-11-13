using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestCases.Common;

namespace QaStudio.Application.Features.WorkerState.GetWorkerTestCases;

/// <summary>Handles <see cref="GetWorkerTestCasesQuery"/>.</summary>
/// <param name="reader">Test case queries.</param>
internal sealed class GetWorkerTestCasesHandler(ITestCaseReader reader) : IRequestHandler<GetWorkerTestCasesQuery, IReadOnlyList<TestCaseResponse>>
{
    private const int PageSize = 1000;

    public async Task<IReadOnlyList<TestCaseResponse>> HandleAsync(GetWorkerTestCasesQuery request, CancellationToken cancellationToken)
    {
        var all = new List<TestCaseResponse>();
        var page = 1;
        bool more;
        do
        {
            var filter = new TestCaseFilter(null, null, null, null, null, null, page++, PageSize);
            var (items, total) = await reader.ListAsync(filter, cancellationToken).ConfigureAwait(false);
            all.AddRange(items.Select(TestCaseMapper.ToResponse));
            more = items.Count > 0 && all.Count < total;
        }
        while (more);

        return all;
    }
}
