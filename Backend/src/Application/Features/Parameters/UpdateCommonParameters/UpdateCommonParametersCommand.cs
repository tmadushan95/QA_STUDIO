using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.Common;

namespace QaStudio.Application.Features.Parameters.UpdateCommonParameters;

/// <summary>Replaces a project's common values. Empty values are dropped.</summary>
/// <param name="ProjectId">The project.</param>
/// <param name="Values">The values as typed.</param>
public sealed record UpdateCommonParametersCommand(int ProjectId, IReadOnlyDictionary<string, string?> Values) : ICommand<CommonParameters>;
