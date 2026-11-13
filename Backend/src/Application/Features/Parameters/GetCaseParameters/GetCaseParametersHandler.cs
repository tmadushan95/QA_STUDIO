using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.Common;

namespace QaStudio.Application.Features.Parameters.GetCaseParameters;

/// <summary>Handles <see cref="GetCaseParametersQuery"/>.</summary>
/// <param name="reads">Reads the parameter views.</param>
internal sealed class GetCaseParametersHandler(ParameterReads reads) : IRequestHandler<GetCaseParametersQuery, CaseParameters>
{
    public Task<CaseParameters> HandleAsync(GetCaseParametersQuery request, CancellationToken cancellationToken) =>
        reads.CaseAsync(request.CaseCode, cancellationToken);
}
