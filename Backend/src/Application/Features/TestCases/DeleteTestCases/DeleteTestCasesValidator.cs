using FluentValidation;
using Microsoft.Extensions.Options;
using QaStudio.Application.Common;
using QaStudio.Application.Features.TestCases.Common;

namespace QaStudio.Application.Features.TestCases.DeleteTestCases;

/// <summary>Validates a delete.</summary>
internal sealed class DeleteTestCasesValidator : AbstractValidator<DeleteTestCasesCommand>
{
    public DeleteTestCasesValidator(IOptions<LimitsOptions> limits) =>
        RuleFor(c => c.Ids).MustBeCaseIds(limits.Value.MaxCasesPerRequest);
}
