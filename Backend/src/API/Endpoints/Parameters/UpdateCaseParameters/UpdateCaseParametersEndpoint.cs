using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.UpdateCaseParameters;

namespace QaStudio.Api.Endpoints.Parameters.UpdateCaseParameters;

/// <summary>The body of PUT /api/parameters/{caseId}.</summary>
/// <param name="Values">Name to value. An empty value clears that name.</param>
public sealed record ParameterValuesRequest(Dictionary<string, string?>? Values);

/// <summary>PUT /api/parameters/{caseId}: replaces a case's own values and returns the case's parameters.</summary>
public sealed class UpdateCaseParametersEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPut(ApiRoutes.CaseParameters, async (string caseId, ParameterValuesRequest request, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new UpdateCaseParametersCommand(caseId, request.Values ?? []), ct).ConfigureAwait(false)))
            .WithTags(ApiTags.TestCases).WithName("UpdateCaseParameters");
}
