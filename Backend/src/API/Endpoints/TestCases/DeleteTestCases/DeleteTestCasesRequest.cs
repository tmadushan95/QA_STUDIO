namespace QaStudio.Api.Endpoints.TestCases.DeleteTestCases;

/// <summary>The body of a delete request. A POST with a list, because a DELETE body is not reliably carried by proxies.</summary>
/// <param name="Ids">The case IDs.</param>
public sealed record DeleteTestCasesRequest(IReadOnlyList<string> Ids);
