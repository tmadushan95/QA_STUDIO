using FluentValidation;
using Microsoft.Extensions.Options;
using QaStudio.Application.Common;

namespace QaStudio.Application.Features.WorkerState.ApplyWorkerOperations;

/// <summary>Validates a batch.</summary>
internal sealed class ApplyWorkerOperationsValidator : AbstractValidator<ApplyWorkerOperationsCommand>
{
    public ApplyWorkerOperationsValidator(IOptions<LimitsOptions> limits)
    {
        var max = limits.Value.MaxWorkerBatch;
        RuleFor(c => c.Operations).NotNull().Must(o => o.Count <= max).WithMessage($"At most {max} operations per batch.");
    }
}
