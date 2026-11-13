namespace QaStudio.Application.Features.TestCases.Common;

/// <summary>Where a test case came from.</summary>
/// <param name="Workbook">File name, or "Created in the app".</param>
/// <param name="Worksheet">Worksheet name.</param>
/// <param name="RowNumber">One-based row number.</param>
public sealed record TestCaseSourceResponse(string Workbook, string Worksheet, int RowNumber);
