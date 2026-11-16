namespace QaStudio.Core.Common;

/// <summary>The audit trail's action names, as people filter and read them.</summary>
public static class AuditActions
{
    /// <summary>A project was created.</summary>
    public const string ProjectCreate = "project.create";

    /// <summary>A project was changed.</summary>
    public const string ProjectUpdate = "project.update";

    /// <summary>A project was deleted.</summary>
    public const string ProjectDelete = "project.delete";

    /// <summary>A suite was created.</summary>
    public const string SuiteCreate = "suite.create";

    /// <summary>A suite was changed.</summary>
    public const string SuiteUpdate = "suite.update";

    /// <summary>A suite was deleted.</summary>
    public const string SuiteDelete = "suite.delete";

    /// <summary>A project version was created.</summary>
    public const string VersionCreate = "version.create";

    /// <summary>A project version was changed.</summary>
    public const string VersionUpdate = "version.update";

    /// <summary>A project version was deleted.</summary>
    public const string VersionDelete = "version.delete";

    /// <summary>Test cases were given a project version.</summary>
    public const string CaseAssignVersion = "inventory.assign-version";

    /// <summary>A page list was saved.</summary>
    public const string PagesUpdate = "pages.update";

    /// <summary>A test case's own parameter values were saved.</summary>
    public const string ParametersUpdate = "parameters.update";

    /// <summary>A project's common parameter values were saved.</summary>
    public const string ParametersCommon = "parameters.common";

    /// <summary>Missing parameter values were filled automatically.</summary>
    public const string ParametersAuto = "parameters.auto";

    /// <summary>A test case was created.</summary>
    public const string CaseCreate = "inventory.create";

    /// <summary>A test case was changed.</summary>
    public const string CaseUpdate = "inventory.update";

    /// <summary>Test cases were deleted.</summary>
    public const string CaseDelete = "inventory.delete";

    /// <summary>Test cases were filed elsewhere.</summary>
    public const string CaseMove = "inventory.move";

    /// <summary>Test cases were put in a new order.</summary>
    public const string CaseReorder = "inventory.reorder";
}
