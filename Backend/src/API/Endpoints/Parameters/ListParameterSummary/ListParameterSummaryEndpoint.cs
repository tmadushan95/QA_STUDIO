using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.Common;
using QaStudio.Application.Features.Parameters.ListParameterSummary;

namespace QaStudio.Api.Endpoints.Parameters.ListParameterSummary;

/// <summary>GET /api/parameters: how many values each case needs and which are missing (cases needing none are left out).</summary>
public sealed class ListParameterSummaryEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapGet(ApiRoutes.Parameters, async (IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(new ItemsResponse<ParameterSummaryRow>(await dispatcher.SendAsync(new ListParameterSummaryQuery(), ct).ConfigureAwait(false))))
            .WithTags(ApiTags.TestCases).WithName("ListParameterSummary");
}
