namespace QaStudio.Core.Common;

/// <summary>Base type for failures the API reports to the caller with a stable code.</summary>
/// <param name="code">Machine-readable error code (kebab-case); the frontend branches on it.</param>
/// <param name="message">A user-safe message.</param>
/// <param name="fields">Optional per-field messages for forms.</param>
/// <param name="inner">The underlying failure, for the log.</param>
public abstract class QaStudioException(string code, string message, IReadOnlyDictionary<string, string>? fields = null, Exception? inner = null)
    : Exception(message, inner)
{
    /// <summary>The message shown above per-field errors.</summary>
    public const string FieldsNeedAttention = "Some fields need attention.";

    /// <summary>Machine-readable error code.</summary>
    public string Code { get; } = code;

    /// <summary>Per-field messages for forms, when the failure relates to specific fields.</summary>
    public IReadOnlyDictionary<string, string>? Fields { get; } = fields;
}
