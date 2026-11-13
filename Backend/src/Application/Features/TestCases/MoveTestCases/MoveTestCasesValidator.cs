using FluentValidation;
using Microsoft.Extensions.Options;
using QaStudio.Application.Common;
using QaStudio.Application.Features.TestCases.Common;

namespace QaStudio.Application.Features.TestCases.MoveTestCases;

/// <summary>Validates a move.</summary>
internal sealed class MoveTestCasesValidator : AbstractValidator<MoveTestCasesCommand>
{
    public MoveTestCasesValidator(IOptions<LimitsOptions> limits)
    {
        RuleFor(c => c.Ids).MustBeCaseIds(limits.Value.MaxCasesPerRequest);
        RuleFor(c => c.TestSuiteId).MustBeAChosenSuite();
    }
}
