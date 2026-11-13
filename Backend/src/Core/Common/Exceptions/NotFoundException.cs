namespace QaStudio.Core.Common;

/// <summary>The requested resource does not exist.</summary>
/// <param name="code">Error code.</param>
/// <param name="message">User-safe message.</param>
public sealed class NotFoundException(string code, string message) : QaStudioException(code, message);
