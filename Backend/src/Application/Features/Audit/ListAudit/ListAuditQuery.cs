using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Features.Audit.ListAudit;

/// <summary>Lists the newest audit entries.</summary>
/// <param name="Limit">How many, within the configured limit.</param>
public sealed record ListAuditQuery(int Limit = 100) : IQuery<IReadOnlyList<AuditResponse>>;
