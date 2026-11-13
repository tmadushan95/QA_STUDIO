using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.Common;
using QaStudio.Application.Features.Parameters.SuggestParameters;

namespace QaStudio.Api.Endpoints.Parameters.SuggestParameters;

/// <summary>The body of the suggest routes: whether to ask the AI (the default).</summary>
/// <param name="Ai">False to skip the AI.</param>
public sealed record SuggestRequest(bool? Ai);

/// <summary>POST /api/parameters/{caseId}/suggest: values for a case's missing parameters, not saved.</summary>
public sealed class SuggestCaseParametersEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPost(ApiRoutes.CaseParametersSuggest, async (string caseId, SuggestRequest? request, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(new ItemsResponse<ParameterSuggestion>(await dispatcher.SendAsync(new SuggestCaseParametersQuery(caseId, request?.Ai != false), ct).ConfigureAwait(false))))
            .WithTags(ApiTags.TestCases).WithName("SuggestCaseParameters");
}

/// <summary>POST /api/parameters/common/{projectId}/suggest: values for a project's empty common names, not saved.</summary>
public sealed class SuggestCommonParametersEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPost(ApiRoutes.CommonParametersSuggest, async (int projectId, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(new ItemsResponse<ParameterSuggestion>(await dispatcher.SendAsync(new SuggestCommonParametersQuery(projectId), ct).ConfigureAwait(false))))
            .WithTags(ApiTags.TestCases).WithName("SuggestCommonParameters");
}
