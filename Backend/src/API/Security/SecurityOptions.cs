namespace QaStudio.Api.Security;

/// <summary>Who may reach the API, from the <c>Security</c> configuration section.</summary>
public sealed class SecurityOptions
{
    /// <summary>The configuration section name.</summary>
    public const string Section = "Security";

    /// <summary>When set, every /api request needs it. Comes from local settings or the environment.</summary>
    public string? AdminToken { get; set; }

    /// <summary>Extra Host names allowed besides loopback.</summary>
    public IReadOnlyList<string> AllowedHosts { get; set; } = [];

    /// <summary>Extra browser origins allowed to make changes.</summary>
    public IReadOnlyList<string> AllowedOrigins { get; set; } = [];

    /// <summary>Mark the session cookie Secure. Set when served over HTTPS.</summary>
    public bool SecureCookie { get; set; }
}
