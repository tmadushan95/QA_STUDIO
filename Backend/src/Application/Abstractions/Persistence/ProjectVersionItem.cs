namespace QaStudio.Application.Abstractions;

/// <summary>A project version as listed; plain data, so it is safe to cache.</summary>
/// <param name="Id">The key.</param>
/// <param name="ProjectId">The project's key.</param>
/// <param name="Name">Display name.</param>
/// <param name="Description">Optional description.</param>
/// <param name="ReleaseDate">Optional release date.</param>
/// <param name="IsCurrent">Whether it is the project's default for new cases.</param>
/// <param name="IsActive">Whether it is offered for new cases.</param>
/// <param name="RowVersion">Concurrency token, base64.</param>
public sealed record ProjectVersionItem(
    int Id,
    int ProjectId,
    string Name,
    string? Description,
    DateOnly? ReleaseDate,
    bool IsCurrent,
    bool IsActive,
    string RowVersion);
