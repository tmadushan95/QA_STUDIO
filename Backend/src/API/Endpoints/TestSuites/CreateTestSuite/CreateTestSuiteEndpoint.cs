using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestSuites.CreateTestSuite;

namespace QaStudio.Api.Endpoints.TestSuites.CreateTestSuite;

/// <summary>POST /api/test-suites.</summary>
public sealed class CreateTestSuiteEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPost(ApiRoutes.TestSuites, async (CreateTestSuiteRequest request, IDispatcher dispatcher, CancellationToken ct) =>
        {
            var created = await dispatcher.SendAsync(new CreateTestSuiteCommand(request.ProjectId, request.Name, request.Description, request.SortOrder), ct).ConfigureAwait(false);
            return TypedResults.Created($"{ApiRoutes.TestSuites}/{created.Id}", created);
        }).WithTags(ApiTags.TestSuites).WithName("CreateTestSuite");
}
