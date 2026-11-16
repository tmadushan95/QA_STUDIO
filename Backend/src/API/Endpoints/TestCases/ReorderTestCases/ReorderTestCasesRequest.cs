namespace QaStudio.Api.Endpoints.TestCases.ReorderTestCases;

/// <summary>The body of a reorder request.</summary>
/// <param name="Ids">The case IDs, in their new order.</param>
public sealed record ReorderTestCasesRequest(IReadOnlyList<string> Ids);
