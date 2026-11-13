using System.Text.RegularExpressions;
using QaStudio.Core.Common;

namespace QaStudio.Core.MasterData;

/// <summary>A product or application under test; the top of the Project → Test Suite → Test Case hierarchy.</summary>
public sealed partial class Project : AuditableEntity<int>
{
    /// <summary>The project that receives imported test cases until someone files them elsewhere.</summary>
    public const string DefaultCode = "GENERAL";

    /// <summary>The name given to the default project when it is created.</summary>
    public const string DefaultName = "General";

    /// <summary>The description given to the default project when it is created.</summary>
    public const string DefaultDescription = "Test cases not yet filed under a project.";

    /// <summary>Longest allowed code.</summary>
    public const int CodeMaxLength = 30;

    /// <summary>Longest allowed name.</summary>
    public const int NameMaxLength = 200;

    /// <summary>Longest allowed description.</summary>
    public const int DescriptionMaxLength = 2000;

    private readonly List<TestSuite> _suites = [];

    private Project()
    {
    }

    /// <summary>Short unique code, always upper case, such as <c>CAPEX</c>.</summary>
    public string Code { get; private set; } = string.Empty;

    /// <summary>Display name.</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>Optional description.</summary>
    public string? Description { get; private set; }

    /// <summary>Inactive projects stay readable but are not offered for new test cases.</summary>
    public bool IsActive { get; private set; } = true;

    /// <summary>The project's test suites.</summary>
    public IReadOnlyCollection<TestSuite> Suites => _suites;

    /// <summary>The stored form of a code, for comparing one with what is stored.</summary>
    /// <param name="code">The code as typed.</param>
    /// <returns>Trimmed and upper case.</returns>
    public static string NormalizeCode(string? code) => Text.OrEmpty(code).ToUpperInvariant();

    /// <summary>Creates a project.</summary>
    /// <param name="code">Unique code.</param>
    /// <param name="name">Display name.</param>
    /// <param name="description">Optional description.</param>
    /// <param name="utcNow">The current UTC time.</param>
    /// <returns>The new project.</returns>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public static Project Create(string? code, string? name, string? description, DateTime utcNow)
    {
        var project = new Project { CreatedAtUtc = utcNow };
        project.Apply(code, name, description, true, utcNow);
        return project;
    }

    /// <summary>Changes the project's details.</summary>
    /// <param name="code">Unique code.</param>
    /// <param name="name">Display name.</param>
    /// <param name="description">Optional description.</param>
    /// <param name="isActive">Whether it is offered for new test cases.</param>
    /// <param name="utcNow">The current UTC time.</param>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public void Update(string? code, string? name, string? description, bool isActive, DateTime utcNow) =>
        Apply(code, name, description, isActive, utcNow);

    /// <summary>
    /// Refuses a delete while anything depends on the project. Never a cascade: one click must not be able to remove a
    /// project's whole test library, and deleted accounts would live on in the worker's copy until its next restart.
    /// </summary>
    /// <param name="suites">How many suites it has.</param>
    /// <param name="accounts">How many test accounts it has.</param>
    /// <exception cref="ConflictException">Something still depends on it.</exception>
    public void EnsureCanBeDeleted(int suites, int accounts)
    {
        if (suites > 0)
        {
            throw new ConflictException(
                ErrorCodes.ProjectHasSuites,
                $"\"{Name}\" still has {Text.Count(suites, "test suite")}. Delete or move them first.");
        }

        if (accounts > 0)
        {
            throw new ConflictException(
                ErrorCodes.ProjectHasAccounts,
                $"\"{Name}\" still has {Text.Count(accounts, "test account")}. Delete them first.");
        }
    }

    private void Apply(string? code, string? name, string? description, bool isActive, DateTime utcNow)
    {
        var normalizedCode = NormalizeCode(code);
        var normalizedName = Text.OrEmpty(name);
        var normalizedDescription = Text.OrNull(description);
        new DomainRules()
            .Required(FieldNames.Code, normalizedCode, "Enter a code.")
            .MaxLength(FieldNames.Code, normalizedCode, CodeMaxLength)
            .That(FieldNames.Code, CodeFormat().IsMatch(normalizedCode), "Use letters, digits, - or _.")
            .Required(FieldNames.Name, normalizedName, "Enter a name.")
            .MaxLength(FieldNames.Name, normalizedName, NameMaxLength)
            .MaxLength(FieldNames.Description, normalizedDescription, DescriptionMaxLength)
            .ThrowIfBroken();
        Code = normalizedCode;
        Name = normalizedName;
        Description = normalizedDescription;
        IsActive = isActive;
        Touch(utcNow);
    }

    [GeneratedRegex("^[A-Z0-9][A-Z0-9_-]*$", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex CodeFormat();
}
