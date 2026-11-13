using QaStudio.Core.Common;

namespace QaStudio.Core.Automation;

/// <summary>
/// One parameter value shared by every case of a project that has no value of its own for that name. Deleted with the project.
/// </summary>
public sealed class ProjectParameterValue
{
    private ProjectParameterValue()
    {
    }

    /// <summary>The project.</summary>
    public int ProjectId { get; private set; }

    /// <summary>The parameter name.</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>The value. Never empty: clearing a value removes the row.</summary>
    public string Value { get; private set; } = string.Empty;

    /// <summary>When the value was last saved (UTC).</summary>
    public DateTime UpdatedAtUtc { get; private set; }

    /// <summary>Creates a value.</summary>
    /// <param name="projectId">The project.</param>
    /// <param name="name">The parameter name.</param>
    /// <param name="value">The value.</param>
    /// <param name="atUtc">When it is saved.</param>
    /// <returns>The value.</returns>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public static ProjectParameterValue Create(int projectId, string name, string value, DateTime atUtc)
    {
        new DomainRules()
            .Required(FieldNames.Name, name, "A parameter needs a name.")
            .MaxLength(FieldNames.Name, name, ParameterLimits.NameMaxLength)
            .Required(FieldNames.Json, value, "A parameter value cannot be empty.")
            .MaxLength(FieldNames.Json, value, ParameterLimits.ValueMaxLength)
            .ThrowIfBroken();
        return new ProjectParameterValue { ProjectId = projectId, Name = name, Value = value, UpdatedAtUtc = atUtc };
    }

    /// <summary>Takes on a newer value of the same parameter.</summary>
    /// <param name="newer">The newer value.</param>
    public void ReplaceWith(ProjectParameterValue newer)
    {
        ArgumentNullException.ThrowIfNull(newer);
        Value = newer.Value;
        UpdatedAtUtc = newer.UpdatedAtUtc;
    }
}
