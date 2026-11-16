using QaStudio.Core.Common;
using QaStudio.Core.TestCases;

namespace QaStudio.Application.Features.TestCases.Common;

/// <summary>
/// Written content shared by create and update, so they cannot drift apart. The API's request bodies extend this, which
/// keeps their JSON flat without repeating the fields. Not <c>required</c>: a missing title should reach the domain's
/// rule and be reported beside its field, not fail as unreadable JSON.
/// </summary>
public record TestCaseInput
{
    /// <summary>One-line title.</summary>
    public string? Title { get; init; }

    /// <summary>Optional longer description.</summary>
    public string? Description { get; init; }

    /// <summary>Module name.</summary>
    public string? Module { get; init; }

    /// <summary>Priority label.</summary>
    public string? Priority { get; init; }

    /// <summary>Severity label.</summary>
    public string? Severity { get; init; }

    /// <summary>Type label.</summary>
    public string? TestType { get; init; }

    /// <summary>The role it runs as.</summary>
    public string? UserRole { get; init; }

    /// <summary>What must be true first.</summary>
    public string? Preconditions { get; init; }

    /// <summary>Overall expected result.</summary>
    public string? ExpectedResult { get; init; }

    /// <summary>Written steps, one action per entry. Left out on an update, the existing steps are kept.</summary>
    public IReadOnlyList<string>? Steps { get; init; }

    /// <summary>
    /// Written steps with each step's expected result, for an editor that shows both. Takes the place of
    /// <see cref="Steps"/> when given, so a form that only knows actions keeps working.
    /// </summary>
    public IReadOnlyList<WrittenStepInput>? WrittenSteps { get; init; }

    /// <summary>Whether the request says what the steps are (on an update, left out means keep them).</summary>
    internal bool HasSteps => WrittenSteps is not null || Steps is not null;

    /// <summary>Tags.</summary>
    public IReadOnlyList<string>? Tags { get; init; }

    /// <summary>Builds the domain content.</summary>
    /// <param name="source">Traceability.</param>
    /// <param name="dependsOnJson">Prerequisites as JSON.</param>
    /// <param name="readiness">Readiness label.</param>
    /// <returns>The content.</returns>
    internal TestCaseContent ToContent(TestCaseSource source, string dependsOnJson, string readiness) =>
        new()
        {
            Title = Text.OrEmpty(Title),
            Description = Text.OrNull(Description),
            Module = Text.OrNull(Module),
            Preconditions = Text.OrNull(Preconditions),
            ExpectedResult = Text.OrNull(ExpectedResult),
            Priority = Text.OrNull(Priority),
            Severity = Text.OrNull(Severity),
            TestType = Text.OrNull(TestType),
            UserRole = Text.OrNull(UserRole),
            TagsJson = TestCaseMapper.ToJsonList(Tags),
            DependsOnJson = dependsOnJson,
            Readiness = readiness,
            Source = source,
        };

    /// <summary>Builds the domain steps.</summary>
    /// <returns>The steps, numbered from 1.</returns>
    internal IEnumerable<TestCaseStep> ToSteps() =>
        WrittenSteps is not null
            ? WrittenSteps.Select((step, index) => new TestCaseStep(index + 1, Text.OrEmpty(step.Action), Text.OrNull(step.Expected)))
            : (Steps ?? []).Select((action, index) => new TestCaseStep(index + 1, Text.OrEmpty(action), null));
}

/// <summary>One written step as an editor sends it.</summary>
/// <param name="Action">What to do.</param>
/// <param name="Expected">What should happen, when the step says.</param>
public sealed record WrittenStepInput(string? Action, string? Expected);
