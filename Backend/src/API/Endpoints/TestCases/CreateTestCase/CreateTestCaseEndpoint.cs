using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestCases.CreateTestCase;

namespace QaStudio.Api.Endpoints.TestCases.CreateTestCase;

/// <summary>POST /api/test-cases.</summary>
public sealed class CreateTestCaseEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPost(ApiRoutes.TestCases, async (CreateTestCaseRequest request, IDispatcher dispatcher, CancellationToken ct) =>
        {
            var created = await dispatcher.SendAsync(new CreateTestCaseCommand(request.Id, request.TestSuiteId, request, request.ProjectVersionId), ct).ConfigureAwait(false);
            return TypedResults.Created($"{ApiRoutes.TestCases}/{Uri.EscapeDataString(created.Id)}", created);
        }).WithTags(ApiTags.TestCases).WithName("CreateTestCase");
}
