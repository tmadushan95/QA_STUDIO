using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.Common;

namespace QaStudio.Application.Features.Parameters.UpdateCaseParameters;

/// <summary>
/// Replaces a case's own values. Empty values are dropped, so clearing a field means "no value of my own": the case then uses
/// its project's common value for that name, if there is one.
/// </summary>
/// <param name="CaseCode">The case ID.</param>
/// <param name="Values">The values as typed.</param>
public sealed record UpdateCaseParametersCommand(string CaseCode, IReadOnlyDictionary<string, string?> Values) : ICommand<CaseParameters>;
