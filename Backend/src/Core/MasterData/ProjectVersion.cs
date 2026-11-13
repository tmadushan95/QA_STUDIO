using QaStudio.Core.Common;

namespace QaStudio.Core.MasterData;

/// <summary>
/// A release of a project, such as "2.4" or "Sprint 18". Test cases can be generated, filed and run per version, so a
/// team can see what each release was tested with. A version belongs to exactly one project.
/// </summary>
public sealed class ProjectVersion : AuditableEntity<int>
{
    /// <summary>Longest allowed name.</summary>
    public const int NameMaxLength = 100;

    /// <summary>Longest allowed description.</summary>
    public const int DescriptionMaxLength = 2000;

    private ProjectVersion()
    {
    }

    /// <summary>The owning project's key.</summary>
    public int ProjectId { get; private set; }

    /// <summary>The owning project.</summary>
    public Project Project { get; private set; } = null!;

    /// <summary>Display name, unique within the project, such as <c>2.4.0</c>.</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>Optional release notes or scope.</summary>
    public string? Description { get; private set; }

    /// <summary>Planned or actual release date, when known.</summary>
    public DateOnly? ReleaseDate { get; private set; }

    /// <summary>
    /// The version new test cases of the project are filed under by default. At most one per project; the handler
    /// clears the flag on the others when one is set.
    /// </summary>
    public bool IsCurrent { get; private set; }

    /// <summary>Inactive (archived) versions stay readable but are not offered for new test cases.</summary>
    public bool IsActive { get; private set; } = true;

    /// <summary>Creates a version under an existing project.</summary>
    /// <param name="projectId">The owning project's key.</param>
    /// <param name="name">Display name.</param>
    /// <param name="description">Optional description.</param>
    /// <param name="releaseDate">Optional release date.</param>
    /// <param name="isCurrent">Whether it becomes the project's current version.</param>
    /// <param name="utcNow">The current UTC time.</param>
    /// <returns>The new version.</returns>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public static ProjectVersion Create(int projectId, string? name, string? description, DateOnly? releaseDate, bool isCurrent, DateTime utcNow)
    {
        new DomainRules().That(FieldNames.ProjectId, projectId > 0, "Choose a project.").ThrowIfBroken();
        var version = new ProjectVersion { ProjectId = projectId, CreatedAtUtc = utcNow };
        version.Apply(name, description, releaseDate, isCurrent, true, utcNow);
        return version;
    }

    /// <summary>Changes the version's details.</summary>
    /// <param name="name">Display name.</param>
    /// <param name="description">Optional description.</param>
    /// <param name="releaseDate">Optional release date.</param>
    /// <param name="isCurrent">Whether it is the project's current version.</param>
    /// <param name="isActive">Whether it is offered for new test cases.</param>
    /// <param name="utcNow">The current UTC time.</param>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public void Update(string? name, string? description, DateOnly? releaseDate, bool isCurrent, bool isActive, DateTime utcNow) =>
        Apply(name, description, releaseDate, isCurrent, isActive, utcNow);

    /// <summary>Stops being the project's current version, because another one became current.</summary>
    /// <param name="utcNow">The current UTC time.</param>
    public void ClearCurrent(DateTime utcNow)
    {
        if (!IsCurrent)
        {
            return;
        }

        IsCurrent = false;
        Touch(utcNow);
    }

    private void Apply(string? name, string? description, DateOnly? releaseDate, bool isCurrent, bool isActive, DateTime utcNow)
    {
        var normalizedName = Text.OrEmpty(name);
        var normalizedDescription = Text.OrNull(description);
        new DomainRules()
            .Required(FieldNames.Name, normalizedName, "Enter a version name, such as 1.0.")
            .MaxLength(FieldNames.Name, normalizedName, NameMaxLength)
            .MaxLength(FieldNames.Description, normalizedDescription, DescriptionMaxLength)
            // An archived version cannot be the default for new cases: nobody could file a case under it.
            .That(FieldNames.IsCurrent, !isCurrent || isActive, "An archived version cannot be the current one.")
            .ThrowIfBroken();
        Name = normalizedName;
        Description = normalizedDescription;
        ReleaseDate = releaseDate;
        IsCurrent = isCurrent;
        IsActive = isActive;
        Touch(utcNow);
    }
}
