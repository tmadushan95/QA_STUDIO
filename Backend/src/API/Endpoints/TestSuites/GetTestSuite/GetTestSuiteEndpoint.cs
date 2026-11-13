using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestSuites.GetTestSuite;

namespace QaStudio.Api.Endpoints.TestSuites.GetTestSuite;

/// <summary>GET /api/test-suites/{id}.</summary>
public sealed class GetTestSuiteEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.TestSuite, async (int id, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new GetTestSuiteQuery(id), ct).ConfigureAwait(false)))
            .WithTags(ApiTags.TestSuites).WithName("GetTestSuite");
}
