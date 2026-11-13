using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestSuites.Common;
using QaStudio.Application.Features.TestSuites.ListTestSuites;

namespace QaStudio.Api.Endpoints.TestSuites.ListTestSuites;

/// <summary>GET /api/test-suites, optionally for one project.</summary>
public sealed class ListTestSuitesEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.TestSuites, async (int? projectId, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(new ItemsResponse<TestSuiteResponse>(await dispatcher.SendAsync(new ListTestSuitesQuery(projectId), ct).ConfigureAwait(false))))
            .WithTags(ApiTags.TestSuites).WithName("ListTestSuites");
}
