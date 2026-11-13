using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Features.WorkerState.GetWorkerConfig;

/// <summary>The worker's refresh of configuration blocks: a block and its per-project blocks (<c>pages</c>, <c>pages:3</c>).</summary>
/// <param name="Prefix">The block's name.</param>
public sealed record GetWorkerConfigQuery(string Prefix) : IQuery<IReadOnlyDictionary<string, string>>;
