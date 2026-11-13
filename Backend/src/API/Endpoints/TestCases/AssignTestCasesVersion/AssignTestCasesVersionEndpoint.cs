using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestCases.AssignTestCasesVersion;

namespace QaStudio.Api.Endpoints.TestCases.AssignTestCasesVersion;

/// <summary>POST /api/test-cases/assign-version.</summary>
public sealed class AssignTestCasesVersionEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPost(ApiRoutes.AssignTestCasesVersion, async (AssignTestCasesVersionRequest request, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(new AssignTestCasesVersionCommand(request.Ids, request.ProjectVersionId), ct).ConfigureAwait(false)))
            .WithTags(ApiTags.TestCases).WithName("AssignTestCasesVersion");
}
