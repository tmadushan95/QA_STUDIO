using FluentValidation;
using Microsoft.Extensions.Options;
using QaStudio.Application.Common;
using QaStudio.Core.MasterData;

namespace QaStudio.Application.Features.TestCases.Common;

/// <summary>How much a form may send for one case. What makes a case valid is the domain's; this is about request size.</summary>
internal sealed class TestCaseInputValidator : AbstractValidator<TestCaseInput>
{
    public TestCaseInputValidator(IOptions<LimitsOptions> limits)
    {
        var (maxSteps, maxLength) = (limits.Value.MaxStepsPerCase, limits.Value.MaxStepLength);
        RuleFor(c => c.Steps).Must(s => s is null || s.Count <= maxSteps).WithMessage($"At most {maxSteps} steps.");
        RuleForEach(c => c.Steps).MaximumLength(maxLength);
        RuleFor(c => c.WrittenSteps).Must(s => s is null || s.Count <= maxSteps).WithMessage($"At most {maxSteps} steps.");
        RuleForEach(c => c.WrittenSteps).ChildRules(step =>
        {
            step.RuleFor(s => s.Action).MaximumLength(maxLength);
            step.RuleFor(s => s.Expected).MaximumLength(maxLength);
        });
    }
}

/// <summary>Request rules that several test case use cases share.</summary>
internal static class TestCaseValidationRules
{
    /// <summary>Requires a suite to have been chosen.</summary>
    /// <typeparam name="T">The request.</typeparam>
    /// <param name="rule">The rule on the suite's key.</param>
    /// <returns>The rule.</returns>
    public static IRuleBuilderOptions<T, int> MustBeAChosenSuite<T>(this IRuleBuilder<T, int> rule) =>
        rule.GreaterThan(0).WithMessage(TestSuiteErrors.ChooseSuiteMessage);

    /// <summary>Requires a list of case IDs of a sensible size.</summary>
    /// <typeparam name="T">The request.</typeparam>
    /// <param name="rule">The rule on the list.</param>
    /// <param name="max">The most allowed.</param>
    /// <returns>The rule.</returns>
    public static IRuleBuilderOptions<T, IReadOnlyList<string>> MustBeCaseIds<T>(this IRuleBuilder<T, IReadOnlyList<string>> rule, int max) =>
        rule.NotEmpty().Must(ids => ids.Count <= max).WithMessage($"At most {max} test cases at once.");
}
