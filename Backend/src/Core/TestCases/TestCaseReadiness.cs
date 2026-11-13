namespace QaStudio.Core.TestCases;

/// <summary>
/// How ready a case is for automation. Text rather than an enum because the worker's step library owns this list and
/// stores the text in its own documents; these are the same values as its <c>AutomationReadiness</c>.
/// </summary>
public static class TestCaseReadiness
{
    /// <summary>Can run as it is.</summary>
    public const string Ready = "ready";

    /// <summary>Some of its steps can run.</summary>
    public const string PartiallySupported = "partially-supported";

    /// <summary>Waiting for test data.</summary>
    public const string NeedsTestData = "needs-test-data";

    /// <summary>Needs a step the library does not have.</summary>
    public const string NeedsNewCapability = "needs-new-capability";

    /// <summary>Nobody has assessed it yet, or it is too vague to automate.</summary>
    public const string NeedsClarification = "needs-clarification";

    /// <summary>A person has to run it.</summary>
    public const string ManualOnly = "manual-only";
}
