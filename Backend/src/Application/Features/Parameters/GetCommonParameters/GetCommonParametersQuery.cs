using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Parameters.Common;

namespace QaStudio.Application.Features.Parameters.GetCommonParameters;

/// <summary>Reads a project's common values, with how many of its cases use and override each.</summary>
/// <param name="ProjectId">The project.</param>
public sealed record GetCommonParametersQuery(int ProjectId) : IQuery<CommonParameters>;
