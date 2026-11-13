using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Pages.Common;

namespace QaStudio.Application.Features.Pages.ListPages;

/// <summary>Reads the shared page list, or one project's own list (not merged), as the settings page edits it.</summary>
/// <param name="ProjectId">The project, or null for the shared list.</param>
public sealed record ListPagesQuery(int? ProjectId = null) : IQuery<IReadOnlyList<PageEntry>>;
