namespace QaStudio.Application.Abstractions;

/// <summary>Read-only, no-tracking queries over test cases (the query side of CQRS).</summary>
public interface ITestCaseReader
{
    /// <summary>Gets one case.</summary>
    /// <param name="caseCode">The case ID.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The case, or null.</returns>
    Task<TestCaseReadModel?> GetAsync(string caseCode, CancellationToken cancellationToken);

    /// <summary>Gets several cases in one query.</summary>
    /// <param name="caseCodes">The case IDs.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The cases found, oldest first.</returns>
    Task<IReadOnlyList<TestCaseReadModel>> GetManyAsync(IReadOnlyCollection<string> caseCodes, CancellationToken cancellationToken);

    /// <summary>Gets one page of matching cases.</summary>
    /// <param name="filter">Filter and page.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The page's rows and the total match count.</returns>
    Task<(IReadOnlyList<TestCaseReadModel> Items, int Total)> ListAsync(TestCaseFilter filter, CancellationToken cancellationToken);

    /// <summary>Counts cases per suite.</summary>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>Case count by suite key.</returns>
    Task<IReadOnlyDictionary<int, int>> CountBySuiteAsync(CancellationToken cancellationToken);

    /// <summary>Counts cases per project version; cases with no version are not counted.</summary>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>Case count by version key.</returns>
    Task<IReadOnlyDictionary<int, int>> CountByVersionAsync(CancellationToken cancellationToken);
}
