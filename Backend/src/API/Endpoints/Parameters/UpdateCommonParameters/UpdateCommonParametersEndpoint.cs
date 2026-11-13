using QaStudio.Api.Common;
using QaStudio.Api.Endpoints.Parameters.UpdateCaseParameters;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.UpdateCommonParameters;

namespace QaStudio.Api.Endpoints.Parameters.UpdateCommonParameters;

/// <summary>PUT /api/parameters/common/{projectId}: replaces a project's common values and returns them.</summary>
public sealed class UpdateCommonParametersEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPut(ApiRoutes.CommonParameters, async (int projectId, ParameterValuesRequest request, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new UpdateCommonParametersCommand(projectId, request.Values ?? []), ct).ConfigureAwait(false)))
            .WithTags(ApiTags.TestCases).WithName("UpdateCommonParameters");
}
