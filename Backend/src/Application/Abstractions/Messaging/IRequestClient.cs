namespace QaStudio.Application.Abstractions;

/// <summary>
/// Which client sent the current request when it is not the web app, such as <c>mcp</c> for an AI assistant. The audit
/// trail notes it, so a reader can tell an assistant's change from a person's.
/// </summary>
public interface IRequestClient
{
    /// <summary>The client's short name, or null for the web app and anything unrecognised.</summary>
    string? Name { get; }
}
