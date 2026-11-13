namespace QaStudio.Api.Common;

/// <summary>The error envelope.</summary>
/// <param name="Error">The error.</param>
public sealed record ErrorResponse(ErrorBody Error);

/// <summary>What went wrong.</summary>
/// <param name="Code">Machine-readable code.</param>
/// <param name="Message">User-safe message.</param>
/// <param name="Fields">Per-field messages for forms.</param>
public sealed record ErrorBody(string Code, string Message, IReadOnlyDictionary<string, string>? Fields = null);
