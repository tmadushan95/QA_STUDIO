using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.AutoConfigureParameters;

namespace QaStudio.Api.Endpoints.Parameters.AutoConfigureParameters;

/// <summary>The body of POST /api/parameters/auto.</summary>
/// <param name="CaseIds">The cases to fill.</param>
/// <param name="Ai">False to skip the AI.</param>
public sealed record AutoConfigureRequest(List<string>? CaseIds, bool? Ai);

/// <summary>POST /api/parameters/auto: fills and saves the missing values of many cases; values a person set are never changed.</summary>
public sealed class AutoConfigureParametersEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPost(ApiRoutes.ParametersAuto, async (AutoConfigureRequest request, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new AutoConfigureParametersCommand(request.CaseIds ?? [], request.Ai != false), ct).ConfigureAwait(false)))
            .WithTags(ApiTags.TestCases).WithName("AutoConfigureParameters");
}
