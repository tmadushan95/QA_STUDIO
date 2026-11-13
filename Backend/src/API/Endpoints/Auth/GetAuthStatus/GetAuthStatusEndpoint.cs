using Microsoft.Extensions.Options;
using QaStudio.Api.Common;
using QaStudio.Api.Security;

namespace QaStudio.Api.Endpoints.Auth.GetAuthStatus;

/// <summary>GET /api/auth/status.</summary>
public sealed class GetAuthStatusEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.AuthStatus, (HttpContext context, SessionStore sessions, IOptions<SecurityOptions> options) =>
        {
            var guard = new ApiSecurityMiddleware(_ => Task.CompletedTask, options, sessions);
            return TypedResults.Ok(new AuthStatusResponse(sessions.TokenRequired, guard.IsAuthenticated(context.Request)));
        }).WithTags(ApiTags.Auth).WithName("GetAuthStatus");
}
