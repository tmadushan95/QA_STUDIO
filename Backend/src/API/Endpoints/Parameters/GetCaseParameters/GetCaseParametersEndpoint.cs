using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.GetCaseParameters;

namespace QaStudio.Api.Endpoints.Parameters.GetCaseParameters;

/// <summary>
/// GET /api/parameters/{caseId}: what a case's steps need and where each value comes from. Saving values, filling them
/// with the AI and the other parameter routes stay with the worker.
/// </summary>
public sealed class GetCaseParametersEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.CaseParameters, async (string caseId, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new GetCaseParametersQuery(caseId), ct).ConfigureAwait(false)))
            .WithTags(ApiTags.TestCases).WithName("GetCaseParameters");
}
