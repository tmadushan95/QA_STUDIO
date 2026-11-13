using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.GetCommonParameters;

namespace QaStudio.Api.Endpoints.Parameters.GetCommonParameters;

/// <summary>GET /api/parameters/common/{projectId}: a project's common values, with how many of its cases use and override each.</summary>
public sealed class GetCommonParametersEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.CommonParameters, async (int projectId, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new GetCommonParametersQuery(projectId), ct).ConfigureAwait(false)))
            .WithTags(ApiTags.TestCases).WithName("GetCommonParameters");
}
