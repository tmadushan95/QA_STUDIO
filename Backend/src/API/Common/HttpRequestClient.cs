using System.Text.RegularExpressions;
using QaStudio.Application.Abstractions;

namespace QaStudio.Api.Common;

/// <summary>
/// Reads the <c>X-QA-Client</c> header (for example <c>mcp/0.2.0</c>). Only a short product name is kept, so the header
/// cannot write arbitrary text into the audit trail. The same rule as the worker's <c>request-client.ts</c>.
/// </summary>
/// <param name="accessor">The current request.</param>
internal sealed partial class HttpRequestClient(IHttpContextAccessor accessor) : IRequestClient
{
    /// <summary>The header's name.</summary>
    public const string Header = "X-QA-Client";

    /// <inheritdoc />
    public string? Name
    {
        get
        {
            var value = accessor.HttpContext?.Request.Headers[Header].ToString().Trim();
            if (string.IsNullOrEmpty(value))
            {
                return null;
            }

            var match = ClientPattern().Match(value);
            return match.Success ? match.Groups[1].Value : null;
        }
    }

    [GeneratedRegex(@"^([a-z][a-z0-9-]{0,19})(/[0-9A-Za-z.+-]{1,20})?$", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex ClientPattern();
}
