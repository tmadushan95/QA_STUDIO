namespace QaStudio.Core.TestCases;

/// <summary>Traceability back to the workbook row (or the app) a test case came from.</summary>
/// <param name="Workbook">File name, or "Created in the app".</param>
/// <param name="Worksheet">Worksheet name.</param>
/// <param name="RowNumber">One-based row number.</param>
public sealed record TestCaseSource(string Workbook, string Worksheet, int RowNumber)
{
    /// <summary>The source of a case typed into the app rather than imported.</summary>
    public static readonly TestCaseSource CreatedInApp = new("Created in the app", "-", 1);
}
