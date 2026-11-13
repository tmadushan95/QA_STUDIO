using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;

namespace QaStudio.Application.Features.ProjectVersions.DeleteProjectVersion;

/// <summary>Deletes a version. Its test cases stay, with no version.</summary>
/// <param name="Id">The key.</param>
public sealed record DeleteProjectVersionCommand(int Id) : ICommand<Unit>;
