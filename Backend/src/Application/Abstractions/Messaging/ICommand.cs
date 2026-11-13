using System.Diagnostics.CodeAnalysis;

namespace QaStudio.Application.Abstractions;

/// <summary>A request that changes state (the write side of CQRS).</summary>
/// <typeparam name="TResult">What the handler returns.</typeparam>
[SuppressMessage("Design", "CA1040:Avoid empty interfaces", Justification = "Marker separating writes from reads.")]
public interface ICommand<out TResult> : IRequest<TResult>;
