using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestCases.MoveTestCases;

namespace QaStudio.Api.Endpoints.TestCases.MoveTestCases;

/// <summary>POST /api/test-cases/move.</summary>
public sealed class MoveTestCasesEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPost(ApiRoutes.MoveTestCases, async (MoveTestCasesRequest request, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new MoveTestCasesCommand(request.Ids, request.TestSuiteId), ct).ConfigureAwait(false)))
            .WithTags(ApiTags.TestCases).WithName("MoveTestCases");
}
