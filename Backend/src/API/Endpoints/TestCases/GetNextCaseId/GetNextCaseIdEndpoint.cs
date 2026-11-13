using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestCases.GetNextCaseId;

namespace QaStudio.Api.Endpoints.TestCases.GetNextCaseId;

/// <summary>GET /api/test-cases/next-id.</summary>
public sealed class GetNextCaseIdEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.NextCaseId, async (IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new GetNextCaseIdQuery(), ct).ConfigureAwait(false)))
            .WithTags(ApiTags.TestCases).WithName("GetNextCaseId");
}
