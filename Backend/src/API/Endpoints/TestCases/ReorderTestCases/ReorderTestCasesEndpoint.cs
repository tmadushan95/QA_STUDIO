using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestCases.ReorderTestCases;

namespace QaStudio.Api.Endpoints.TestCases.ReorderTestCases;

/// <summary>POST /api/test-cases/reorder.</summary>
public sealed class ReorderTestCasesEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPost(ApiRoutes.ReorderTestCases, async (ReorderTestCasesRequest request, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new ReorderTestCasesCommand(request.Ids), ct).ConfigureAwait(false)))
            .WithTags(ApiTags.TestCases).WithName("ReorderTestCases");
}
