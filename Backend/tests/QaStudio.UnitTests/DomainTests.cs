using QaStudio.Core.Automation;
using QaStudio.Core.Common;
using QaStudio.Core.MasterData;
using QaStudio.Core.TestCases;

namespace QaStudio.UnitTests;

public class DomainTests
{
    private static readonly DateTime Now = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    private static TestCaseContent Content(string title = "Title") =>
        new() { Title = title, Source = new TestCaseSource("w", "s", 1) };

    [Fact]
    public void A_project_code_is_upper_case_and_blank_text_becomes_null()
    {
        var project = Project.Create(" capex ", "  Capex  ", "   ", Now);
        Assert.Equal("CAPEX", project.Code);
        Assert.Equal("Capex", project.Name);
        Assert.Null(project.Description);
        Assert.True(project.IsActive);
    }

    [Theory]
    [InlineData("", "Name", "code")]
    [InlineData("has space", "Name", "code")]
    [InlineData("OK", "", "name")]
    public void A_project_refuses_bad_values_and_names_the_field(string code, string name, string field)
    {
        var error = Assert.Throws<DomainValidationException>(() => Project.Create(code, name, null, Now));
        Assert.Equal(ErrorCodes.InvalidRequest, error.Code);
        Assert.Contains(field, error.Fields!.Keys);
    }

    [Fact]
    public void A_project_reports_every_broken_rule_at_once()
    {
        var error = Assert.Throws<DomainValidationException>(() => Project.Create(null, null, new string('x', Project.DescriptionMaxLength + 1), Now));
        Assert.Equal(["code", "name", "description"], error.Fields!.Keys);
    }

    [Fact]
    public void A_project_with_dependents_cannot_be_deleted()
    {
        var project = Project.Create("A", "A", null, Now);
        Assert.Equal(ErrorCodes.ProjectHasSuites, Assert.Throws<ConflictException>(() => project.EnsureCanBeDeleted(1, 1)).Code);
        Assert.Equal(ErrorCodes.ProjectHasAccounts, Assert.Throws<ConflictException>(() => project.EnsureCanBeDeleted(0, 2)).Code);
        project.EnsureCanBeDeleted(0, 0);
    }

    [Fact]
    public void A_version_needs_a_name_and_a_project_and_trims_its_text()
    {
        var version = ProjectVersion.Create(3, "  2.4.0 ", "  ", new DateOnly(2026, 12, 1), true, Now);
        Assert.Equal("2.4.0", version.Name);
        Assert.Null(version.Description);
        Assert.True(version.IsCurrent);
        Assert.True(version.IsActive);
        var error = Assert.Throws<DomainValidationException>(() => ProjectVersion.Create(0, " ", null, null, false, Now));
        Assert.Equal(["projectId"], error.Fields!.Keys);
        error = Assert.Throws<DomainValidationException>(() => ProjectVersion.Create(1, new string('x', ProjectVersion.NameMaxLength + 1), null, null, false, Now));
        Assert.Contains("name", error.Fields!.Keys);
    }

    [Fact]
    public void An_archived_version_cannot_be_current_and_clearing_current_is_idempotent()
    {
        var version = ProjectVersion.Create(1, "1.0", null, null, true, Now);
        var error = Assert.Throws<DomainValidationException>(() => version.Update("1.0", null, null, true, false, Now));
        Assert.Contains("isCurrent", error.Fields!.Keys);
        version.ClearCurrent(Now);
        version.ClearCurrent(Now);
        Assert.False(version.IsCurrent);
    }

    [Fact]
    public void A_case_can_be_given_and_cleared_of_a_version_but_not_a_bad_key()
    {
        var testCase = TestCase.Create("TC_1", 1, Content(), [new TestCaseStep(1, "Open", null)], Now);
        testCase.AssignVersion(7, Now);
        Assert.Equal(7, testCase.ProjectVersionId);
        testCase.AssignVersion(null, Now);
        Assert.Null(testCase.ProjectVersionId);
        Assert.Throws<DomainValidationException>(() => testCase.AssignVersion(0, Now));
    }

    [Fact]
    public void A_suite_refuses_a_blank_name_and_a_negative_position()
    {
        var error = Assert.Throws<DomainValidationException>(() => TestSuite.Create(1, " ", null, -1, Now));
        Assert.Equal(["name", "sortOrder"], error.Fields!.Keys);
    }

    [Fact]
    public void A_case_needs_a_title_and_an_id_and_steps_with_text()
    {
        Assert.Contains("title", Assert.Throws<DomainValidationException>(() => TestCase.Create("TC_01", 1, Content(" "), [], Now)).Fields!.Keys);
        Assert.Contains("id", Assert.Throws<DomainValidationException>(() => TestCase.Create(" ", 1, Content(), [], Now)).Fields!.Keys);
        Assert.Contains("steps", Assert.Throws<DomainValidationException>(() => new TestCaseStep(1, " ", null)).Fields!.Keys);
    }

    [Fact]
    public void A_stored_document_refuses_what_its_column_cannot_hold()
    {
        var error = Assert.Throws<DomainValidationException>(() => TestAccount.Create("a", 0, new string('x', DocumentLimits.LabelMaxLength + 1), "u", "c", "t", "t"));
        Assert.Contains("projectId", error.Fields!.Keys);
        Assert.Contains("label", error.Fields.Keys);
    }

    [Fact]
    public void Updating_a_case_replaces_its_steps()
    {
        var testCase = TestCase.Create("TC_01", 1, Content(), [new TestCaseStep(1, "old", null)], Now);
        testCase.Update(Content("New"), [new TestCaseStep(1, "a", "b"), new TestCaseStep(2, "c", null)], Now);
        Assert.Equal("New", testCase.Title);
        Assert.Equal(["a", "c"], testCase.Steps.Select(s => s.Action));
    }

    [Fact]
    public void Moving_a_case_changes_only_its_suite()
    {
        var testCase = TestCase.Create("TC_01", 1, Content(), [new TestCaseStep(1, "a", null)], Now);
        testCase.MoveTo(2, Now.AddDays(1));
        Assert.Equal(2, testCase.TestSuiteId);
        Assert.Single(testCase.Steps);
        Assert.Equal(Now.AddDays(1), testCase.UpdatedAtUtc);
    }
}

