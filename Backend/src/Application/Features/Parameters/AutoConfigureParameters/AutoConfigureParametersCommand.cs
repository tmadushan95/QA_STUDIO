using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.Common;

namespace QaStudio.Application.Features.Parameters.AutoConfigureParameters;

/// <summary>
/// Fills and saves the missing values of many cases at once. Values a person set are never changed.
/// </summary>
/// <param name="CaseIds">The cases (1 to 5000).</param>
/// <param name="UseAi">Whether to ask the AI.</param>
public sealed record AutoConfigureParametersCommand(IReadOnlyList<string> CaseIds, bool UseAi = true) : ICommand<AutoConfigureResult>;

/// <summary>What auto-configuring did.</summary>
/// <param name="Configured">How many cases got values.</param>
/// <param name="Filled">How many values were added in all.</param>
/// <param name="StillMissing">Cases that still lack a value (a password-like name, say).</param>
public sealed record AutoConfigureResult(int Configured, int Filled, IReadOnlyList<ParameterSummaryRow> StillMissing);
