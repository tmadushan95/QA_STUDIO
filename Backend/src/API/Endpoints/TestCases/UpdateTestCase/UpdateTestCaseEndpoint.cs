using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestCases.UpdateTestCase;

namespace QaStudio.Api.Endpoints.TestCases.UpdateTestCase;

/// <summary>PUT /api/test-cases/{caseId}.</summary>
public sealed class UpdateTestCaseEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPut(ApiRoutes.TestCase, async (string caseId, UpdateTestCaseRequest request, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new UpdateTestCaseCommand(caseId, request.TestSuiteId, request, request.RowVersion), ct).ConfigureAwait(false)))
            .WithTags(ApiTags.TestCases).WithName("UpdateTestCase");
}
