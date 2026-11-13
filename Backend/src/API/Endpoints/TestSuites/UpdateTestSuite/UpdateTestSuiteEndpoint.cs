using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestSuites.UpdateTestSuite;

namespace QaStudio.Api.Endpoints.TestSuites.UpdateTestSuite;

/// <summary>PUT /api/test-suites/{id}.</summary>
public sealed class UpdateTestSuiteEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapPut(ApiRoutes.TestSuite, async (int id, UpdateTestSuiteRequest request, IDispatcher dispatcher, CancellationToken ct) =>
            TypedResults.Ok(await dispatcher.SendAsync(
                new UpdateTestSuiteCommand(id, request.Name, request.Description, request.SortOrder, request.IsActive, request.RowVersion),
                ct).ConfigureAwait(false)))
            .WithTags(ApiTags.TestSuites).WithName("UpdateTestSuite");
}
