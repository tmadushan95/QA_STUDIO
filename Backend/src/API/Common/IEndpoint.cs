namespace QaStudio.Api.Common;

/// <summary>One endpoint (the E of REPR): a class that maps one route and does nothing but translate HTTP.</summary>
public interface IEndpoint
{
    /// <summary>Maps the route.</summary>
    /// <param name="routes">The route builder.</param>
    void Map(IEndpointRouteBuilder routes);
}
