namespace QaStudio.Core.Common;

/// <summary>The stable, machine-readable error codes of the API. The frontend branches on these, so they never change.</summary>
public static class ErrorCodes
{
    /// <summary>A field or request is not acceptable.</summary>
    public const string InvalidRequest = "invalid-request";

    /// <summary>The page list has a problem.</summary>
    public const string InvalidPages = "invalid-pages";

    /// <summary>The body could not be read.</summary>
    public const string BadRequest = "bad-request";

    /// <summary>An unexpected failure.</summary>
    public const string Internal = "internal";

    /// <summary>The row changed after the editor opened it.</summary>
    public const string ChangedSinceOpened = "changed-since-opened";

    /// <summary>A unique value is already taken.</summary>
    public const string Duplicate = "duplicate";

    /// <summary>A foreign key refused the change.</summary>
    public const string InUse = "in-use";

    /// <summary>No such run.</summary>
    public const string UnknownRun = "unknown-run";

    /// <summary>No such project.</summary>
    public const string UnknownProject = "unknown-project";

    /// <summary>A project code is already taken.</summary>
    public const string DuplicateCode = "duplicate-code";

    /// <summary>A project still has test suites.</summary>
    public const string ProjectHasSuites = "project-has-suites";

    /// <summary>A project still has test accounts.</summary>
    public const string ProjectHasAccounts = "project-has-accounts";

    /// <summary>No such test suite.</summary>
    public const string UnknownSuite = "unknown-suite";

    /// <summary>A suite name is already taken in the project.</summary>
    public const string DuplicateSuite = "duplicate-suite";

    /// <summary>A suite still holds test cases.</summary>
    public const string SuiteHasCases = "suite-has-cases";

    /// <summary>No such project version.</summary>
    public const string UnknownVersion = "unknown-version";

    /// <summary>A version name is already taken in the project.</summary>
    public const string DuplicateVersion = "duplicate-version";

    /// <summary>A case was given a version of another project.</summary>
    public const string VersionProjectMismatch = "version-project-mismatch";

    /// <summary>No such test case.</summary>
    public const string UnknownCase = "unknown-case";

    /// <summary>A case ID is already taken.</summary>
    public const string DuplicateId = "duplicate-id";

    /// <summary>A worker operation kind nobody handles.</summary>
    public const string UnknownOperation = "unknown-operation";

    /// <summary>A worker operation is malformed.</summary>
    public const string InvalidOperation = "invalid-operation";
}
