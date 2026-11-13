using System.Globalization;
using System.Text.Json;
using QaStudio.Core.Common;

namespace QaStudio.Application.Features.WorkerState.ApplyWorkerOperations.Strategies;

/// <summary>Reads the fields of an operation, refusing a malformed one instead of storing it.</summary>
internal static class WorkerPayload
{
    /// <summary>The operation's key.</summary>
    /// <param name="operation">The operation.</param>
    /// <returns>The key.</returns>
    public static string Key(WorkerOperation operation) =>
        string.IsNullOrEmpty(operation.Key)
            ? throw Invalid($"\"{operation.Kind}\" needs a key.")
            : operation.Key;

    /// <summary>The operation's payload.</summary>
    /// <param name="operation">The operation.</param>
    /// <returns>The payload.</returns>
    public static JsonElement Required(WorkerOperation operation) =>
        operation.Payload ?? throw Invalid($"\"{operation.Kind}\" needs a payload.");

    /// <summary>A required text property.</summary>
    /// <param name="payload">The payload.</param>
    /// <param name="name">The property.</param>
    /// <returns>Its value.</returns>
    public static string Text(JsonElement payload, string name) =>
        payload.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? string.Empty
            : throw Invalid($"Missing \"{name}\".");

    /// <summary>An optional text property.</summary>
    /// <param name="payload">The payload.</param>
    /// <param name="name">The property.</param>
    /// <returns>Its value, or empty.</returns>
    public static string OptionalText(JsonElement payload, string name) =>
        payload.TryGetProperty(name, out var value) ? value.GetString() ?? string.Empty : string.Empty;

    /// <summary>A required whole-number property.</summary>
    /// <param name="payload">The payload.</param>
    /// <param name="name">The property.</param>
    /// <returns>Its value.</returns>
    public static int Int(JsonElement payload, string name) =>
        payload.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)
            ? number
            : throw Invalid($"Missing \"{name}\".");

    /// <summary>A required date property.</summary>
    /// <param name="payload">The payload.</param>
    /// <param name="name">The property.</param>
    /// <returns>Its UTC value.</returns>
    public static DateTime Date(JsonElement payload, string name) =>
        DateTime.TryParse(Text(payload, name), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var value)
            ? value
            : throw Invalid($"\"{name}\" is not a date.");

    private static RequestValidationException Invalid(string message) => new(ErrorCodes.InvalidOperation, message);
}
