using QaStudio.Api.Common;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.TestSuites.DeleteTestSuite;

namespace QaStudio.Api.Endpoints.TestSuites.DeleteTestSuite;

/// <summary>DELETE /api/test-suites/{id}.</summary>
public sealed class DeleteTestSuiteEndpoint : IEndpoint
{
    /// <inheritdoc />
    public void Map(IEndpointRouteBuilder routes) =>
        routes.MapDelete(ApiRoutes.TestSuite, async (int id, IDispatcher dispatcher, CancellationToken ct) =>
        {
            await dispatcher.SendAsync(new DeleteTestSuiteCommand(id), ct).ConfigureAwait(false);
            return TypedResults.NoContent();
        }).WithTags(ApiTags.TestSuites).WithName("DeleteTestSuite");
}
