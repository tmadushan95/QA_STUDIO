namespace QaStudio.Application.Common;

/// <summary>Name conversion shared by anything that reports field names to forms.</summary>
internal static class JsonNames
{
    /// <summary>Converts a property name to camelCase.</summary>
    /// <param name="name">The name.</param>
    /// <returns>The camelCase name.</returns>
    public static string ToCamelCase(string name) =>
        string.IsNullOrEmpty(name) ? name : System.Text.Json.JsonNamingPolicy.CamelCase.ConvertName(name);
}
