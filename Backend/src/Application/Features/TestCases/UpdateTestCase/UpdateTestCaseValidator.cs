using FluentValidation;
using QaStudio.Application.Features.TestCases.Common;

namespace QaStudio.Application.Features.TestCases.UpdateTestCase;

/// <summary>Validates the shape of a test case update.</summary>
internal sealed class UpdateTestCaseValidator : AbstractValidator<UpdateTestCaseCommand>
{
    public UpdateTestCaseValidator(TestCaseInputValidator input)
    {
        RuleFor(c => c.TestSuiteId).MustBeAChosenSuite();
        RuleFor(c => c.Input).SetValidator(input).OverridePropertyName(string.Empty);
    }
}
