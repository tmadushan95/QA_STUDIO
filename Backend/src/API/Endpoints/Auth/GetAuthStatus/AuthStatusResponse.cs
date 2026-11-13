namespace QaStudio.Api.Endpoints.Auth.GetAuthStatus;

/// <summary>What the access-token screen needs to know.</summary>
/// <param name="Required">Whether a token is configured.</param>
/// <param name="Authenticated">Whether this request is signed in.</param>
public sealed record AuthStatusResponse(bool Required, bool Authenticated);
