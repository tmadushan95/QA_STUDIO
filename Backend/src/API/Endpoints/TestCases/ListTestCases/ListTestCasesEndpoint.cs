using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestCases.ListTestCases;

namespace QaStudio.Api.Endpoints.TestCases.ListTestCases;

/// <summary>GET /api/test-cases.</summary>
public sealed class ListTestCasesEndpoint : IEndpoint
{
    private const int FirstPage = 1;
    private const int DefaultPageSize = 25;

    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.TestCases, async ([AsParameters] ListTestCasesRequest request, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(
                new ListTestCasesQuery(request.ProjectId, request.TestSuiteId, request.ProjectVersionId, request.Q, request.Module, request.Priority, request.Page ?? FirstPage, request.PageSize ?? DefaultPageSize),
                ct).ConfigureAwait(false)))
            .WithTags(ApiTags.TestCases).WithName("ListTestCases");
}
