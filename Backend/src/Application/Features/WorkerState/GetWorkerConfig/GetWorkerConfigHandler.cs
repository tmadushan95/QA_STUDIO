using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Features.WorkerState.GetWorkerConfig;

/// <summary>Handles <see cref="GetWorkerConfigQuery"/>.</summary>
/// <param name="config">Configuration blocks.</param>
internal sealed class GetWorkerConfigHandler(IConfigStore config) : IRequestHandler<GetWorkerConfigQuery, IReadOnlyDictionary<string, string>>
{
    public Task<IReadOnlyDictionary<string, string>> HandleAsync(GetWorkerConfigQuery request, CancellationToken cancellationToken) =>
        config.GetByPrefixAsync(request.Prefix, cancellationToken);
}
