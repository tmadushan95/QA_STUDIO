using FluentValidation;
using Microsoft.Extensions.Options;
using QaStudio.Application.Common;
using QaStudio.Application.Features.TestCases.Common;

namespace QaStudio.Application.Features.TestCases.ReorderTestCases;

/// <summary>Validates a reorder.</summary>
internal sealed class ReorderTestCasesValidator : AbstractValidator<ReorderTestCasesCommand>
{
    public ReorderTestCasesValidator(IOptions<LimitsOptions> limits)
    {
        RuleFor(c => c.Ids).MustBeCaseIds(limits.Value.MaxCasesPerRequest);
    }
}
