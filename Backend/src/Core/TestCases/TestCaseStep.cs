using QaStudio.Core.Common;

namespace QaStudio.Core.TestCases;

/// <summary>One written step of a test case.</summary>
public sealed class TestCaseStep : Entity<long>
{
    private TestCaseStep()
    {
    }

    /// <summary>Creates a step.</summary>
    /// <param name="order">One-based position.</param>
    /// <param name="action">What the tester does.</param>
    /// <param name="expected">What should happen, when the source gave it.</param>
    /// <exception cref="DomainValidationException">A value breaks the rules.</exception>
    public TestCaseStep(int order, string? action, string? expected)
    {
        new DomainRules()
            .That(FieldNames.Steps, order > 0, "Number steps from 1.")
            .Required(FieldNames.Steps, action, "A step cannot be empty.")
            .ThrowIfBroken();
        StepOrder = order;
        Action = action ?? string.Empty;
        Expected = expected;
    }

    /// <summary>The owning test case's key, set by the database when the case is saved.</summary>
    public long TestCaseId { get; }

    /// <summary>One-based position within the case.</summary>
    public int StepOrder { get; private set; }

    /// <summary>What the tester does.</summary>
    public string Action { get; private set; } = string.Empty;

    /// <summary>What should happen, when the source gave it. Never invented.</summary>
    public string? Expected { get; private set; }
}
