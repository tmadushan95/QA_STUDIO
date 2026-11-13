namespace QaStudio.Application.Abstractions;

/// <summary>A project as listed; plain data, so it is safe to cache.</summary>
/// <param name="Id">The key.</param>
/// <param name="Code">Unique code.</param>
/// <param name="Name">Display name.</param>
/// <param name="Description">Optional description.</param>
/// <param name="IsActive">Whether it is offered for new cases.</param>
/// <param name="RowVersion">Concurrency token, base64.</param>
public sealed record ProjectItem(int Id, string Code, string Name, string? Description, bool IsActive, string RowVersion);
