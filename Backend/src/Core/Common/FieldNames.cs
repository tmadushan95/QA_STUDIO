namespace QaStudio.Core.Common;

/// <summary>The field names forms bind errors to. They match the JSON property names of the API.</summary>
public static class FieldNames
{
    /// <summary>A key or case ID.</summary>
    public const string Id = "id";

    /// <summary>A project code.</summary>
    public const string Code = "code";

    /// <summary>A display name.</summary>
    public const string Name = "name";

    /// <summary>A description.</summary>
    public const string Description = "description";

    /// <summary>A list position.</summary>
    public const string SortOrder = "sortOrder";

    /// <summary>A case title.</summary>
    public const string Title = "title";

    /// <summary>A case module.</summary>
    public const string Module = "module";

    /// <summary>A case priority.</summary>
    public const string Priority = "priority";

    /// <summary>A case severity.</summary>
    public const string Severity = "severity";

    /// <summary>A case type.</summary>
    public const string TestType = "testType";

    /// <summary>The role a case runs as.</summary>
    public const string UserRole = "userRole";

    /// <summary>A case's written steps.</summary>
    public const string Steps = "steps";

    /// <summary>A case's readiness.</summary>
    public const string Readiness = "readiness";

    /// <summary>Where a case came from.</summary>
    public const string Source = "source";

    /// <summary>The suite something is filed under.</summary>
    public const string TestSuiteId = "testSuiteId";

    /// <summary>The project something belongs to.</summary>
    public const string ProjectId = "projectId";

    /// <summary>A label.</summary>
    public const string Label = "label";

    /// <summary>A sign-in name.</summary>
    public const string Username = "username";

    /// <summary>A key of a stored document.</summary>
    public const string Key = "key";

    /// <summary>A status.</summary>
    public const string Status = "status";

    /// <summary>A stored JSON document.</summary>
    public const string Json = "json";

    /// <summary>What happened, in an audit entry.</summary>
    public const string Action = "action";

    /// <summary>What it happened to, in an audit entry.</summary>
    public const string Target = "target";

    /// <summary>A reason.</summary>
    public const string Reason = "reason";

    /// <summary>A project version's key.</summary>
    public const string ProjectVersionId = "projectVersionId";

    /// <summary>Whether a version is the project's current one.</summary>
    public const string IsCurrent = "isCurrent";

    /// <summary>A secret, as ciphertext.</summary>
    public const string Secret = "secret";
}
