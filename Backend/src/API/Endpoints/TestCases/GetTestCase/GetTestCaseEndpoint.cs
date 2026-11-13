using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestCases.GetTestCase;

namespace QaStudio.Api.Endpoints.TestCases.GetTestCase;

/// <summary>GET /api/test-cases/{caseId}.</summary>
public sealed class GetTestCaseEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.TestCase, async (string caseId, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new GetTestCaseQuery(caseId), ct).ConfigureAwait(false)))
            .WithTags(ApiTags.TestCases).WithName("GetTestCase");
}
