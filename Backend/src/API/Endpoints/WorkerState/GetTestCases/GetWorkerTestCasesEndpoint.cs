using QaStudio.Api.Common;
using QaStudio.Api.Security;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestCases.Common;
using QaStudio.Application.Features.WorkerState.GetWorkerTestCases;

namespace QaStudio.Api.Endpoints.WorkerState.GetTestCases;

/// <summary>GET /internal/persistence/test-cases: every test case, for a refresh before a run.</summary>
public sealed class GetWorkerTestCasesEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.WorkerTestCases, async (IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(new ItemsResponse<TestCaseResponse>(await dispatcher.SendAsync(new GetWorkerTestCasesQuery(), ct).ConfigureAwait(false))))
            .AddEndpointFilter<InternalTokenFilter>().ExcludeFromDescription();
}
