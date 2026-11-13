using QaStudio.Core.Common;

namespace QaStudio.Core.MasterData;

/// <summary>A group of related test cases inside a project (the "task" or "section" level of the hierarchy).</summary>
public sealed class TestSuite : AuditableEntity<int>
{
    /// <summary>The suite for test cases that arrive without a module.</summary>
    public const string UnassignedName = "Unassigned";

    /// <summary>The description of the seeded suite for test cases that arrive without a module.</summary>
    public const string UnassignedDescription = "Test cases that arrived without a module.";

    /// <summary>Longest allowed name. Suites are auto-created from imported module names, so this matches that column.</summary>
    public const int NameMaxLength = 400;

    /// <summary>Longest allowed description.</summary>
    public const int DescriptionMaxLength = 2000;

    private TestSuite()
    {
    }

    /// <summary>The owning project's key.</summary>
    public int ProjectId { get; private set; }

    /// <summary>The owning project.</summary>
    public Project Project { get; private set; } = null!;

    /// <summary>Display name, unique within the project.</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>Optional description.</summary>
    public string? Description { get; private set; }

    /// <summary>Position in the project's list; lower comes first.</summary>
    public int SortOrder { get; private set; }

    /// <summary>Inactive suites stay readable but are not offered for new test cases.</summary>
    public bool IsActive { get; private set; } = true;

    /// <summary>Creates a suite under an existing project.</summary>
    /// <param name="projectId">The owning project's key.</param>
    /// <param name="name">Display name.</param>
    /// <param name="description">Optional description.</param>
    /// <param name="sortOrder">Position in the list.</param>
    /// <param name="utcNow">The current UTC time.</param>
    /// <returns>The new suite.</returns>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public static TestSuite Create(int projectId, string? name, string? description, int sortOrder, DateTime utcNow)
    {
        var suite = new TestSuite { ProjectId = projectId, CreatedAtUtc = utcNow };
        suite.Apply(name, description, sortOrder, true, utcNow);
        return suite;
    }

    /// <summary>Creates a suite under a project that may not be saved yet.</summary>
    /// <param name="project">The owning project.</param>
    /// <param name="name">Display name.</param>
    /// <param name="utcNow">The current UTC time.</param>
    /// <returns>The new suite.</returns>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public static TestSuite CreateUnder(Project project, string? name, DateTime utcNow)
    {
        ArgumentNullException.ThrowIfNull(project);
        var suite = new TestSuite { Project = project, CreatedAtUtc = utcNow };
        suite.Apply(name, null, 0, true, utcNow);
        return suite;
    }

    /// <summary>Changes the suite's details.</summary>
    /// <param name="name">Display name.</param>
    /// <param name="description">Optional description.</param>
    /// <param name="sortOrder">Position in the list.</param>
    /// <param name="isActive">Whether it is offered for new test cases.</param>
    /// <param name="utcNow">The current UTC time.</param>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public void Update(string? name, string? description, int sortOrder, bool isActive, DateTime utcNow) =>
        Apply(name, description, sortOrder, isActive, utcNow);

    /// <summary>Refuses a delete while the suite holds test cases.</summary>
    /// <param name="testCases">How many it holds.</param>
    /// <exception cref="ConflictException">It still holds some.</exception>
    public void EnsureCanBeDeleted(int testCases)
    {
        if (testCases > 0)
        {
            throw new ConflictException(
                ErrorCodes.SuiteHasCases,
                $"\"{Name}\" still holds {Text.Count(testCases, "test case")}. Move or delete them first.");
        }
    }

    private void Apply(string? name, string? description, int sortOrder, bool isActive, DateTime utcNow)
    {
        var normalizedName = Text.OrEmpty(name);
        var normalizedDescription = Text.OrNull(description);
        new DomainRules()
            .Required(FieldNames.Name, normalizedName, "Enter a name.")
            .MaxLength(FieldNames.Name, normalizedName, NameMaxLength)
            .MaxLength(FieldNames.Description, normalizedDescription, DescriptionMaxLength)
            .That(FieldNames.SortOrder, sortOrder >= 0, "Use 0 or more.")
            .ThrowIfBroken();
        Name = normalizedName;
        Description = normalizedDescription;
        SortOrder = sortOrder;
        IsActive = isActive;
        Touch(utcNow);
    }
}
