using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.Common;

namespace QaStudio.Application.Features.Parameters.SuggestParameters;

/// <summary>Handles <see cref="SuggestCaseParametersQuery"/>.</summary>
/// <param name="cases">Reads the case.</param>
/// <param name="suggester">Suggests the values.</param>
internal sealed class SuggestCaseParametersHandler(IParameterCaseReader cases, ParameterSuggester suggester) : IRequestHandler<SuggestCaseParametersQuery, IReadOnlyList<ParameterSuggestion>>
{
    public async Task<IReadOnlyList<ParameterSuggestion>> HandleAsync(SuggestCaseParametersQuery request, CancellationToken cancellationToken)
    {
        if ((await cases.ReadProjectsAsync([request.CaseCode], cancellationToken).ConfigureAwait(false)).Count == 0)
        {
            throw ParameterReads.UnknownCase(request.CaseCode);
        }

        return await suggester.ForCaseAsync(request.CaseCode, request.UseAi, cancellationToken).ConfigureAwait(false);
    }
}

/// <summary>Handles <see cref="SuggestCommonParametersQuery"/>.</summary>
/// <param name="suggester">Suggests the values.</param>
internal sealed class SuggestCommonParametersHandler(ParameterSuggester suggester) : IRequestHandler<SuggestCommonParametersQuery, IReadOnlyList<ParameterSuggestion>>
{
    public Task<IReadOnlyList<ParameterSuggestion>> HandleAsync(SuggestCommonParametersQuery request, CancellationToken cancellationToken) =>
        suggester.ForProjectAsync(request.ProjectId, cancellationToken);
}
