using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.Common;

namespace QaStudio.Application.Features.Parameters.GetCommonParameters;

/// <summary>Handles <see cref="GetCommonParametersQuery"/>.</summary>
/// <param name="reads">Reads the parameter views.</param>
internal sealed class GetCommonParametersHandler(ParameterReads reads) : IRequestHandler<GetCommonParametersQuery, CommonParameters>
{
    public Task<CommonParameters> HandleAsync(GetCommonParametersQuery request, CancellationToken cancellationToken) =>
        reads.ProjectAsync(request.ProjectId, cancellationToken);
}
