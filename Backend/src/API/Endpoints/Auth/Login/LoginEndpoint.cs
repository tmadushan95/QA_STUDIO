using Microsoft.Extensions.Options;
using QaStudio.Api.Common;
using QaStudio.Api.Security;

namespace QaStudio.Api.Endpoints.Auth.Login;

/// <summary>POST /api/auth/login: exchanges the token for an HttpOnly cookie the page cannot read.</summary>
public sealed class LoginEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPost(ApiRoutes.Login, (LoginRequest request, HttpContext context, SessionStore sessions, IOptions<SecurityOptions> options) =>
        {
            if (!sessions.TokenRequired)
            {
                return Results.NoContent();
            }

            if (!sessions.TryCountAttempt())
            {
                return Results.Json(
                    new ErrorResponse(new ErrorBody("too-many-attempts", "Too many sign-in attempts. Wait a minute and try again.")),
                    statusCode: StatusCodes.Status429TooManyRequests);
            }

            if (string.IsNullOrEmpty(request.Token) || !sessions.TokenMatches(request.Token))
            {
                return Results.Json(new ErrorResponse(new ErrorBody("wrong-token", "That access token is not right.")), statusCode: StatusCodes.Status401Unauthorized);
            }

            var cookie = new CookieBuilder
            {
                HttpOnly = true,
                SameSite = SameSiteMode.Strict,
                Path = "/",
                MaxAge = SessionStore.SessionLifetime,
                // Secure whenever the request itself is HTTPS; the setting forces it behind a proxy that ends TLS.
                SecurePolicy = options.Value.SecureCookie ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest,
            };
            context.Response.Cookies.Append(ApiSecurityMiddleware.CookieName, sessions.Start(), cookie.Build(context));
            return Results.NoContent();
        }).WithTags(ApiTags.Auth).WithName("Login");
}
