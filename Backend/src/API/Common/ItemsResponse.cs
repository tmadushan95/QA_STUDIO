namespace QaStudio.Api.Common;

/// <summary>A list of items, in the envelope every list route uses.</summary>
/// <typeparam name="T">The item type.</typeparam>
/// <param name="Items">The items.</param>
public sealed record ItemsResponse<T>(IReadOnlyList<T> Items);
