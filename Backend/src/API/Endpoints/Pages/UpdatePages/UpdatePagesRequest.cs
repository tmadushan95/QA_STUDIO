using QaStudio.Application.Features.Pages.Common;

namespace QaStudio.Api.Endpoints.Pages.UpdatePages;

/// <summary>The body of PUT /api/pages.</summary>
/// <param name="Pages">The new list.</param>
/// <param name="ProjectId">The project whose own list is replaced; leave out for the shared list.</param>
public sealed record UpdatePagesRequest(List<PageInput>? Pages, int? ProjectId);

/// <summary>One page as sent. Any value may be left out (a page without a marker is common); it is then empty.</summary>
/// <param name="Name">The name testers use in steps.</param>
/// <param name="Route">The path on the application.</param>
/// <param name="Marker">Text that shows the page has loaded.</param>
public sealed record PageInput(string? Name, string? Route, string? Marker)
{
    /// <summary>The page, with a missing value as an empty one (the rules then name it).</summary>
    /// <returns>The page.</returns>
    public PageEntry ToEntry() => new(Name ?? string.Empty, Route ?? string.Empty, Marker ?? string.Empty);
}
