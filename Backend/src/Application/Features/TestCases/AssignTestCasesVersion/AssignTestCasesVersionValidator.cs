using FluentValidation;
using Microsoft.Extensions.Options;
using QaStudio.Application.Common;
using QaStudio.Application.Features.TestCases.Common;

namespace QaStudio.Application.Features.TestCases.AssignTestCasesVersion;

/// <summary>Validates a version assignment.</summary>
internal sealed class AssignTestCasesVersionValidator : AbstractValidator<AssignTestCasesVersionCommand>
{
    public AssignTestCasesVersionValidator(IOptions<LimitsOptions> limits)
    {
        RuleFor(c => c.Ids).MustBeCaseIds(limits.Value.MaxCasesPerRequest);
        RuleFor(c => c.ProjectVersionId).GreaterThan(0).When(c => c.ProjectVersionId is not null).WithMessage("Choose a version.");
    }
}
