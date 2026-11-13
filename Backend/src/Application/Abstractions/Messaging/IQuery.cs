using System.Diagnostics.CodeAnalysis;

namespace QaStudio.Application.Abstractions;

/// <summary>A request that only reads (the read side of CQRS).</summary>
/// <typeparam name="TResult">What the handler returns.</typeparam>
[SuppressMessage("Design", "CA1040:Avoid empty interfaces", Justification = "Marker separating reads from writes.")]
public interface IQuery<out TResult> : IRequest<TResult>;
