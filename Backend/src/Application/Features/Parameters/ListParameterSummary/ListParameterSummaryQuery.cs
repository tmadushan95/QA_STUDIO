using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.Common;

namespace QaStudio.Application.Features.Parameters.ListParameterSummary;

/// <summary>For list pages: how many values each case needs and which are missing.</summary>
public sealed record ListParameterSummaryQuery : IQuery<IReadOnlyList<ParameterSummaryRow>>;
