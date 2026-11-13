using QaStudio.Core.TestCases;

namespace QaStudio.Application.Abstractions;

/// <summary>Repository for test cases.</summary>
public interface ITestCaseRepository : IRepository<TestCase>
{
    /// <summary>Gets a test case with its steps, for changing.</summary>
    /// <param name="caseCode">The case ID.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The case, or null.</returns>
    Task<TestCase?> FindAsync(string caseCode, CancellationToken cancellationToken);

    /// <summary>Gets test cases for changing, without steps.</summary>
    /// <param name="caseCodes">The case IDs.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The cases found.</returns>
    Task<IReadOnlyList<TestCase>> FindManyAsync(IReadOnlyCollection<string> caseCodes, CancellationToken cancellationToken);

    /// <summary>Whether a case ID is in use.</summary>
    /// <param name="caseCode">The case ID.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>True if it is.</returns>
    Task<bool> ExistsAsync(string caseCode, CancellationToken cancellationToken);

    /// <summary>Every case ID in use.</summary>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The IDs.</returns>
    Task<IReadOnlyList<string>> ListCodesAsync(CancellationToken cancellationToken);

    /// <summary>Removes every test case at once. Pending changes are saved first.</summary>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>How many went.</returns>
    Task<int> DeleteAllAsync(CancellationToken cancellationToken);
}
