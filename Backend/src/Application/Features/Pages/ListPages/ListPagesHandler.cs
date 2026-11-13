using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Pages.Common;

namespace QaStudio.Application.Features.Pages.ListPages;

/// <summary>Handles <see cref="ListPagesQuery"/>.</summary>
/// <param name="config">Configuration blocks.</param>
internal sealed class ListPagesHandler(IConfigStore config) : IRequestHandler<ListPagesQuery, IReadOnlyList<PageEntry>>
{
    public async Task<IReadOnlyList<PageEntry>> HandleAsync(ListPagesQuery request, CancellationToken cancellationToken) =>
        PageList.Parse(await config.GetJsonAsync(PageList.KeyOf(request.ProjectId), cancellationToken).ConfigureAwait(false));
}
