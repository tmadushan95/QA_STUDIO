using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.Common;

namespace QaStudio.Application.Features.Parameters.GetCaseParameters;

/// <summary>Reads one case's parameters: what its steps need, the value each has and where it comes from.</summary>
/// <param name="CaseCode">The case ID.</param>
public sealed record GetCaseParametersQuery(string CaseCode) : IQuery<CaseParameters>;
