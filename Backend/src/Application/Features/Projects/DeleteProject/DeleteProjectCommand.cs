using QaStudio.Application.Abstractions;
using QaStudio.Application.Common;

namespace QaStudio.Application.Features.Projects.DeleteProject;

/// <summary>Deletes a project that nothing depends on.</summary>
/// <param name="Id">The key.</param>
public sealed record DeleteProjectCommand(int Id) : ICommand<Unit>;
