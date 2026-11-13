using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Features.WorkerState.GetWorkerSnapshot;

/// <summary>Reads everything the worker loads at start-up.</summary>
public sealed record GetWorkerSnapshotQuery : IQuery<GetWorkerSnapshotResponse>;
