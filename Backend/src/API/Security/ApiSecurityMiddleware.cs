using Microsoft.Extensions.Options;
using QaStudio.Api.Common;

namespace QaStudio.Api.Security;

/// <summary>
/// The checks the browser-facing edge must make, carried over unchanged from the old Node API: a Host check stops DNS
/// rebinding, an Origin check stops other websites driving the API through the user's browser, and an optional token
/// protects everything. Requests forwarded to the worker pass here first.
/// </summary>
/// <param name="next">The next middleware.</param>
/// <param name="options">Security settings.</param>
/// <param name="sessions">Sign-in sessions.</param>
public sealed class ApiSecurityMiddleware(RequestDelegate next, IOptions<SecurityOptions> options, SessionStore sessions)
{
    /// <summary>The session cookie's name.</summary>
    public const string CookieName = "qa_session";

    private static readonly HashSet<string> Loopback = new(StringComparer.OrdinalIgnoreCase) { "localhost", "127.0.0.1", "[::1]", "::1" };

    /// <summary>Runs the checks.</summary>
    /// <param name="context">The request.</param>
    /// <returns>A task that completes when the request is finished.</returns>
    public async Task InvokeAsync(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        context.Response.Headers.XContentTypeOptions = "nosniff";
        context.Response.Headers.XFrameOptions = "DENY";
        context.Response.Headers["Referrer-Policy"] = "no-referrer";
        var host = context.Request.Host.Host;
        if (!Loopback.Contains(host) && !options.Value.AllowedHosts.Contains(host, StringComparer.OrdinalIgnoreCase))
        {
            await DenyAsync(context, StatusCodes.Status421MisdirectedRequest, "host-not-allowed", "This address is not allowed. Open the app at http://localhost or its configured address.").ConfigureAwait(false);
            return;
        }

        var path = context.Request.Path;
        if (!path.StartsWithSegments("/api", StringComparison.Ordinal))
        {
            await next(context).ConfigureAwait(false);
            return;
        }

        if (!IsSafeMethod(context.Request.Method) && !IsAllowedOrigin(context.Request))
        {
            await DenyAsync(context, StatusCodes.Status403Forbidden, "origin-not-allowed", "Changes can only be made from this app, not from another website.").ConfigureAwait(false);
            return;
        }

        var isOpen = path.Equals("/api/health", StringComparison.Ordinal) || path.StartsWithSegments("/api/auth", StringComparison.Ordinal);
        if (!isOpen && !IsAuthenticated(context.Request))
        {
            await DenyAsync(context, StatusCodes.Status401Unauthorized, "unauthorized", "Sign in with the access token to continue.").ConfigureAwait(false);
            return;
        }

        await next(context).ConfigureAwait(false);
    }

    /// <summary>Whether a request carries a valid token or session.</summary>
    /// <param name="request">The request.</param>
    /// <returns>True if it does, or if no token is configured.</returns>
    public bool IsAuthenticated(HttpRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!sessions.TokenRequired)
        {
            return true;
        }

        var header = request.Headers.Authorization.ToString();
        const string Bearer = "Bearer ";
        if (header.StartsWith(Bearer, StringComparison.OrdinalIgnoreCase) && sessions.TokenMatches(header[Bearer.Length..].Trim()))
        {
            return true;
        }

        return request.Cookies.TryGetValue(CookieName, out var id) && sessions.IsLive(id);
    }

    private static bool IsSafeMethod(string method) =>
        HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method);

    private bool IsAllowedOrigin(HttpRequest request)
    {
        if (string.Equals(request.Headers["Sec-Fetch-Site"], "cross-site", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var origin = request.Headers.Origin.ToString();
        if (origin.Length == 0)
        {
            return true;
        }

        var host = request.Host.Value;
        return string.Equals(origin, $"{Uri.UriSchemeHttp}{Uri.SchemeDelimiter}{host}", StringComparison.OrdinalIgnoreCase)
            || string.Equals(origin, $"{Uri.UriSchemeHttps}{Uri.SchemeDelimiter}{host}", StringComparison.OrdinalIgnoreCase)
            || options.Value.AllowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase);
    }

    private static Task DenyAsync(HttpContext context, int status, string code, string message)
    {
        context.Response.StatusCode = status;
        return context.Response.WriteAsJsonAsync(new ErrorResponse(new ErrorBody(code, message)), context.RequestAborted);
    }
}
