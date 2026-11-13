using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestCases.DeleteTestCases;

namespace QaStudio.Api.Endpoints.TestCases.DeleteTestCases;

/// <summary>POST /api/test-cases/delete.</summary>
public sealed class DeleteTestCasesEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPost(ApiRoutes.DeleteTestCases, async (DeleteTestCasesRequest request, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new DeleteTestCasesCommand(request.Ids), ct).ConfigureAwait(false)))
            .WithTags(ApiTags.TestCases).WithName("DeleteTestCases");
}
