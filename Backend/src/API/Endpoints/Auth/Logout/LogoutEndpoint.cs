using QaStudio.Api.Common;
using QaStudio.Api.Security;

namespace QaStudio.Api.Endpoints.Auth.Logout;

/// <summary>POST /api/auth/logout.</summary>
public sealed class LogoutEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPost(ApiRoutes.Logout, (HttpContext context, SessionStore sessions) =>
        {
            if (context.Request.Cookies.TryGetValue(ApiSecurityMiddleware.CookieName, out var id))
            {
                sessions.End(id);
            }

            context.Response.Cookies.Delete(ApiSecurityMiddleware.CookieName);
            return Results.NoContent();
        }).WithTags(ApiTags.Auth).WithName("Logout");
}
