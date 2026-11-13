using QaStudio.Application.Abstractions;
using QaStudio.Core.Common;

namespace QaStudio.Application.Features.WorkerState.ApplyWorkerOperations;

/// <summary>Handles <see cref="ApplyWorkerOperationsCommand"/>: picks each operation's strategy by its kind.</summary>
/// <param name="handlers">The strategies.</param>
/// <param name="unitOfWork">Unit of work.</param>
/// <param name="cache">Master data cache; imports can create suites.</param>
internal sealed class ApplyWorkerOperationsHandler(
    IEnumerable<IWorkerOperationHandler> handlers,
    IUnitOfWork unitOfWork,
    IMasterDataCacheInvalidator cache) : IRequestHandler<ApplyWorkerOperationsCommand, ApplyWorkerOperationsResponse>
{
    private readonly Dictionary<string, IWorkerOperationHandler> _byKind =
        handlers.SelectMany(h => h.Kinds.Select(k => (k, h))).ToDictionary(x => x.k, x => x.h, StringComparer.Ordinal);

    public async Task<ApplyWorkerOperationsResponse> HandleAsync(ApplyWorkerOperationsCommand request, CancellationToken cancellationToken)
    {
        await unitOfWork.ExecuteInTransactionAsync(
            async ct =>
            {
                foreach (var operation in request.Operations)
                {
                    if (!_byKind.TryGetValue(operation.Kind, out var handler))
                    {
                        throw new RequestValidationException(ErrorCodes.UnknownOperation, $"Unknown operation \"{operation.Kind}\".");
                    }

                    await handler.ApplyAsync(operation, ct).ConfigureAwait(false);
                }

                await unitOfWork.SaveChangesAsync(ct).ConfigureAwait(false);
            },
            cancellationToken).ConfigureAwait(false);
        cache.Invalidate();
        return new ApplyWorkerOperationsResponse(request.Operations.Count);
    }
}
