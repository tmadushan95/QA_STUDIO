using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.Common;

namespace QaStudio.Application.Features.Parameters.SuggestParameters;

/// <summary>Values for a case's missing parameters, without saving them.</summary>
/// <param name="CaseCode">The case ID.</param>
/// <param name="UseAi">Whether to ask the AI.</param>
public sealed record SuggestCaseParametersQuery(string CaseCode, bool UseAi = true) : IQuery<IReadOnlyList<ParameterSuggestion>>;

/// <summary>Values for a project's empty common names, without saving them.</summary>
/// <param name="ProjectId">The project.</param>
public sealed record SuggestCommonParametersQuery(int ProjectId) : IQuery<IReadOnlyList<ParameterSuggestion>>;
