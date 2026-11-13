using FluentValidation;
using QaStudio.Application.Features.TestCases.Common;

namespace QaStudio.Application.Features.TestCases.CreateTestCase;

/// <summary>Validates the shape of a new test case.</summary>
internal sealed class CreateTestCaseValidator : AbstractValidator<CreateTestCaseCommand>
{
    public CreateTestCaseValidator(TestCaseInputValidator input)
    {
        RuleFor(c => c.TestSuiteId).MustBeAChosenSuite();
        RuleFor(c => c.Input).SetValidator(input).OverridePropertyName(string.Empty);
    }
}
