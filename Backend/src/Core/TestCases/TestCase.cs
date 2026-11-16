using QaStudio.Core.Common;
using QaStudio.Core.MasterData;

namespace QaStudio.Core.TestCases;

/// <summary>A written test case, filed under exactly one test suite.</summary>
public sealed class TestCase : AuditableEntity<long>
{
    /// <summary>Default readiness of a case nobody has assessed yet.</summary>
    public const string DefaultReadiness = TestCaseReadiness.NeedsClarification;

    /// <summary>Longest allowed case code.</summary>
    public const int CodeMaxLength = 200;

    /// <summary>Longest allowed title.</summary>
    public const int TitleMaxLength = 2000;

    /// <summary>Longest allowed short label (module, priority and so on).</summary>
    public const int LabelMaxLength = 400;

    /// <summary>Longest allowed readiness label.</summary>
    public const int ReadinessMaxLength = 40;

    private readonly List<TestCaseStep> _steps = [];

    private TestCase()
    {
    }

    /// <summary>The ID people and scenarios use, such as <c>TC_01</c>. Unique across all projects.</summary>
    public string CaseCode { get; private set; } = string.Empty;

    /// <summary>The owning suite's key.</summary>
    public int TestSuiteId { get; private set; }

    /// <summary>
    /// Where the case sits in the lists and in a run, set once someone reorders it. Until then the case sorts by
    /// <see cref="Entity{TId}.Id"/>, so new cases (from any source) land at the end with no extra write.
    /// </summary>
    public long? SortOrder { get; private set; }

    /// <summary>The owning suite.</summary>
    public TestSuite TestSuite { get; private set; } = null!;

    /// <summary>The project version the case was written for, when one was chosen.</summary>
    public int? ProjectVersionId { get; private set; }

    /// <summary>One-line title.</summary>
    public string Title { get; private set; } = string.Empty;

    /// <summary>Optional longer description.</summary>
    public string? Description { get; private set; }

    /// <summary>Module name as written in the source workbook.</summary>
    public string? Module { get; private set; }

    /// <summary>What must be true before the case starts.</summary>
    public string? Preconditions { get; private set; }

    /// <summary>The overall expected result.</summary>
    public string? ExpectedResult { get; private set; }

    /// <summary>Priority label.</summary>
    public string? Priority { get; private set; }

    /// <summary>Severity label.</summary>
    public string? Severity { get; private set; }

    /// <summary>Type label, such as Regression.</summary>
    public string? TestType { get; private set; }

    /// <summary>The role the case runs as.</summary>
    public string? UserRole { get; private set; }

    /// <summary>Tags as a JSON array. Never filtered on in SQL, so a child table would only add joins.</summary>
    public string TagsJson { get; private set; } = TestCaseContent.EmptyJsonList;

    /// <summary>IDs of prerequisite cases as a JSON array.</summary>
    public string DependsOnJson { get; private set; } = TestCaseContent.EmptyJsonList;

    /// <summary>Automation readiness label.</summary>
    public string Readiness { get; private set; } = DefaultReadiness;

    /// <summary>Source workbook.</summary>
    public string SourceWorkbook { get; private set; } = string.Empty;

    /// <summary>Source worksheet.</summary>
    public string SourceWorksheet { get; private set; } = string.Empty;

    /// <summary>Source row.</summary>
    public int SourceRowNumber { get; private set; }

    /// <summary>The written steps.</summary>
    public IReadOnlyCollection<TestCaseStep> Steps => _steps;

    /// <summary>Creates a test case in a suite that already exists.</summary>
    /// <param name="caseCode">Unique case ID.</param>
    /// <param name="testSuiteId">The suite's key.</param>
    /// <param name="content">The written content.</param>
    /// <param name="steps">The written steps.</param>
    /// <param name="utcNow">The current UTC time.</param>
    /// <returns>The new test case.</returns>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public static TestCase Create(
        string caseCode,
        int testSuiteId,
        TestCaseContent content,
        IEnumerable<TestCaseStep> steps,
        DateTime utcNow)
    {
        var testCase = new TestCase { CaseCode = caseCode, TestSuiteId = testSuiteId, CreatedAtUtc = utcNow };
        testCase.Initialize(content, steps, utcNow);
        return testCase;
    }

    /// <summary>Creates a test case in a suite that may not be saved yet (auto-created during an import).</summary>
    /// <param name="caseCode">Unique case ID.</param>
    /// <param name="suite">The suite.</param>
    /// <param name="content">The written content.</param>
    /// <param name="steps">The written steps.</param>
    /// <param name="utcNow">The current UTC time.</param>
    /// <returns>The new test case.</returns>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public static TestCase CreateIn(
        string caseCode,
        TestSuite suite,
        TestCaseContent content,
        IEnumerable<TestCaseStep> steps,
        DateTime utcNow)
    {
        var testCase = new TestCase { CaseCode = caseCode, TestSuite = suite, CreatedAtUtc = utcNow };
        testCase.Initialize(content, steps, utcNow);
        return testCase;
    }

    /// <summary>Replaces the written content and steps. The suite is unchanged.</summary>
    /// <param name="content">The written content.</param>
    /// <param name="steps">The written steps.</param>
    /// <param name="utcNow">The current UTC time.</param>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public void Update(TestCaseContent content, IEnumerable<TestCaseStep> steps, DateTime utcNow)
    {
        ArgumentNullException.ThrowIfNull(content);
        Validate(content);
        Title = content.Title;
        Description = content.Description;
        Module = content.Module;
        Preconditions = content.Preconditions;
        ExpectedResult = content.ExpectedResult;
        Priority = content.Priority;
        Severity = content.Severity;
        TestType = content.TestType;
        UserRole = content.UserRole;
        TagsJson = content.TagsJson;
        DependsOnJson = content.DependsOnJson;
        Readiness = content.Readiness;
        SourceWorkbook = content.Source.Workbook;
        SourceWorksheet = content.Source.Worksheet;
        SourceRowNumber = content.Source.RowNumber;
        _steps.Clear();
        _steps.AddRange(steps);
        Touch(utcNow);
    }

    /// <summary>Gives the case a project version, or clears it with null.</summary>
    /// <param name="projectVersionId">The version's key, or null for no version.</param>
    /// <param name="utcNow">The current UTC time.</param>
    /// <exception cref="DomainValidationException">The key cannot be a version's.</exception>
    public void AssignVersion(int? projectVersionId, DateTime utcNow)
    {
        new DomainRules().That(FieldNames.ProjectVersionId, projectVersionId is null or > 0, "Choose a version.").ThrowIfBroken();
        ProjectVersionId = projectVersionId;
        Touch(utcNow);
    }

    /// <summary>Files the case under another suite.</summary>
    /// <param name="testSuiteId">The new suite's key.</param>
    /// <param name="utcNow">The current UTC time.</param>
    /// <exception cref="DomainValidationException">The key cannot be a suite's.</exception>
    public void MoveTo(int testSuiteId, DateTime utcNow)
    {
        new DomainRules().That(FieldNames.TestSuiteId, testSuiteId > 0, TestSuiteErrors.ChooseSuiteMessage).ThrowIfBroken();
        TestSuiteId = testSuiteId;
        Touch(utcNow);
    }

    /// <summary>Puts the case at a new place in the list order.</summary>
    /// <param name="sortOrder">The new sort key.</param>
    /// <param name="utcNow">The current UTC time.</param>
    public void Reorder(long sortOrder, DateTime utcNow)
    {
        SortOrder = sortOrder;
        Touch(utcNow);
    }

    private static void Validate(TestCaseContent content) =>
        new DomainRules()
            .Required(FieldNames.Title, content.Title, "Enter a title.")
            .MaxLength(FieldNames.Title, content.Title, TitleMaxLength)
            .MaxLength(FieldNames.Module, content.Module, LabelMaxLength)
            .MaxLength(FieldNames.Priority, content.Priority, LabelMaxLength)
            .MaxLength(FieldNames.Severity, content.Severity, LabelMaxLength)
            .MaxLength(FieldNames.TestType, content.TestType, LabelMaxLength)
            .MaxLength(FieldNames.UserRole, content.UserRole, LabelMaxLength)
            .MaxLength(FieldNames.Readiness, content.Readiness, ReadinessMaxLength)
            .MaxLength(FieldNames.Source, content.Source.Workbook, LabelMaxLength)
            .MaxLength(FieldNames.Source, content.Source.Worksheet, LabelMaxLength)
            .ThrowIfBroken();

    private void Initialize(TestCaseContent content, IEnumerable<TestCaseStep> steps, DateTime utcNow)
    {
        new DomainRules()
            .Required(FieldNames.Id, CaseCode, "Enter an ID.")
            .MaxLength(FieldNames.Id, CaseCode, CodeMaxLength)
            .ThrowIfBroken();
        Update(content, steps, utcNow);
    }
}
