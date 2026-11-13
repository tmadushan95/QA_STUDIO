using QaStudio.Api.Common;

namespace QaStudio.Api.Endpoints.Health.GetHealth;

/// <summary>GET /api/health: reports that the API is up.</summary>
public sealed class GetHealthEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.Health, () => TypedResults.Ok(new HealthResponse("ok")))
            .WithTags(ApiTags.System).WithName("GetHealth");
}
