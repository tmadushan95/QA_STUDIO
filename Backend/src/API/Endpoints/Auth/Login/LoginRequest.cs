namespace QaStudio.Api.Endpoints.Auth.Login;

/// <summary>The sign-in request.</summary>
/// <param name="Token">The access token.</param>
public sealed record LoginRequest(string? Token);
