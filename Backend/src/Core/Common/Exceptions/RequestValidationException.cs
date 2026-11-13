namespace QaStudio.Core.Common;

/// <summary>The request is malformed: wrong shape, or an ID that refers to nothing. Rules of an entity are the domain's.</summary>
/// <param name="code">Error code.</param>
/// <param name="message">User-safe message.</param>
/// <param name="fields">Optional per-field messages.</param>
public sealed class RequestValidationException(string code, string message, IReadOnlyDictionary<string, string>? fields = null)
    : QaStudioException(code, message, fields);
