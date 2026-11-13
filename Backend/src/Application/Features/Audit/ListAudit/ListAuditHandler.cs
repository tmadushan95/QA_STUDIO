using System.Globalization;
using Microsoft.Extensions.Options;
using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;
using QaStudio.Core.Automation;

namespace QaStudio.Application.Features.Audit.ListAudit;

/// <summary>Handles <see cref="ListAuditQuery"/>.</summary>
/// <param name="audit">Audit trail.</param>
/// <param name="limits">Request limits.</param>
internal sealed class ListAuditHandler(IAuditRepository audit, IOptions<LimitsOptions> limits)
    : IRequestHandler<ListAuditQuery, IReadOnlyList<AuditResponse>>
{
    // The way the JavaScript worker writes times, so both sides show them alike.
    private const string WorkerDateFormat = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";

    public async Task<IReadOnlyList<AuditResponse>> HandleAsync(ListAuditQuery request, CancellationToken cancellationToken)
    {
        var limit = Math.Clamp(request.Limit, 1, limits.Value.MaxAuditEntries);
        var entries = await audit.ListAsync(limit, cancellationToken).ConfigureAwait(false);
        return [.. entries.Select(ToResponse)];
    }

    private static AuditResponse ToResponse(AuditEntry e) =>
        new(e.Id, DateTime.SpecifyKind(e.AtUtc, DateTimeKind.Utc).ToString(WorkerDateFormat, CultureInfo.InvariantCulture), e.Action, e.Target, e.Detail);
}
