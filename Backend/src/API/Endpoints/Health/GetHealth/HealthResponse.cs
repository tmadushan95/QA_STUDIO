namespace QaStudio.Api.Endpoints.Health.GetHealth;

/// <summary>The health answer.</summary>
/// <param name="Status">Always <c>ok</c> when the API can answer.</param>
public sealed record HealthResponse(string Status);
