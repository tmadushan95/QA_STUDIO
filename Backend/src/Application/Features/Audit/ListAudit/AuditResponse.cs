namespace QaStudio.Application.Features.Audit.ListAudit;

/// <summary>An audit entry as the API shows it.</summary>
/// <param name="Id">Rising key.</param>
/// <param name="At">When it happened, ISO-8601.</param>
/// <param name="Action">What happened.</param>
/// <param name="Target">What it happened to.</param>
/// <param name="Detail">A readable description.</param>
public sealed record AuditResponse(long Id, string At, string Action, string Target, string Detail);
