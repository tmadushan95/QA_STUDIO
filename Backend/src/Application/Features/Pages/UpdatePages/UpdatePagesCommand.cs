using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Pages.Common;

namespace QaStudio.Application.Features.Pages.UpdatePages;

/// <summary>Replaces the shared page list, or one project's own list.</summary>
/// <param name="Pages">The new list.</param>
/// <param name="ProjectId">The project whose own list is replaced; null for the shared list.</param>
public sealed record UpdatePagesCommand(IReadOnlyList<PageEntry> Pages, int? ProjectId = null) : ICommand<IReadOnlyList<PageEntry>>;
