namespace QaStudio.Core.Common;

/// <summary>The request conflicts with current data, such as a duplicate or a stale edit.</summary>
/// <param name="code">Error code.</param>
/// <param name="message">User-safe message.</param>
/// <param name="fields">Optional per-field messages.</param>
/// <param name="inner">The underlying failure, for the log.</param>
public sealed class ConflictException(string code, string message, IReadOnlyDictionary<string, string>? fields = null, Exception? inner = null)
    : QaStudioException(code, message, fields, inner);
