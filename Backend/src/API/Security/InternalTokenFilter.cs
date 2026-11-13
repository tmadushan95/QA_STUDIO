using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using QaStudio.Api.Common;
using QaStudio.Infrastructure;

namespace QaStudio.Api.Security;

/// <summary>
/// Guards the /internal routes the worker uses. They hand over ciphertext and full history, so they refuse everything
/// unless a shared secret is configured and matches; there is no open default.
/// </summary>
/// <param name="options">Worker settings.</param>
public sealed class InternalTokenFilter(IOptions<WorkerOptions> options) : IEndpointFilter
{
    /// <summary>The header carrying the secret.</summary>
    public const string HeaderName = "x-qa-internal-token";

    /// <inheritdoc />
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);
        var expected = options.Value.InternalToken;
        var given = context.HttpContext.Request.Headers[HeaderName].ToString();
        var matches = !string.IsNullOrEmpty(expected) && CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(given)),
            SHA256.HashData(Encoding.UTF8.GetBytes(expected)));
        return matches
            ? await next(context).ConfigureAwait(false)
            : Results.Json(new ErrorResponse(new ErrorBody("unauthorized", "Internal route.")), statusCode: StatusCodes.Status401Unauthorized);
    }
}

