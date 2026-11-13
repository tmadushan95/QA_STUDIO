using QaStudio.Application.Abstractions;
using QaStudio.Application.Features.Pages.Common;
using QaStudio.Core.Common;
using QaStudio.Core.MasterData;

namespace QaStudio.Application.Features.Pages.UpdatePages;

/// <summary>Handles <see cref="UpdatePagesCommand"/>.</summary>
/// <param name="config">Configuration blocks.</param>
/// <param name="projects">Projects, to check the list is for one that exists.</param>
/// <param name="audit">The audit trail.</param>
/// <param name="unitOfWork">Commits the change.</param>
/// <param name="worker">Tells the worker, which reads the list when it runs tests.</param>
internal sealed class UpdatePagesHandler(
    IConfigStore config,
    IProjectRepository projects,
    IAuditRepository audit,
    IUnitOfWork unitOfWork,
    IWorkerNotifier worker) : IRequestHandler<UpdatePagesCommand, IReadOnlyList<PageEntry>>
{
    public async Task<IReadOnlyList<PageEntry>> HandleAsync(UpdatePagesCommand request, CancellationToken cancellationToken)
    {
        var problems = PageList.Check(request.Pages);
        if (problems.Count > 0)
        {
            throw new RequestValidationException(ErrorCodes.InvalidPages, "Some pages could not be saved.", problems);
        }

        if (request.ProjectId is { } id && await projects.FindAsync(id, cancellationToken).ConfigureAwait(false) is null)
        {
            throw ProjectErrors.NotFound();
        }

        var pages = PageList.Trimmed(request.Pages);
        var key = PageList.KeyOf(request.ProjectId);
        var json = PageList.Serialize(pages);
        await config.SaveJsonAsync(key, json, cancellationToken).ConfigureAwait(false);
        audit.Add(AuditActions.PagesUpdate, request.ProjectId is { } p ? $"project {p}" : "pages", $"Saved {pages.Count} pages.");
        await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await worker.ConfigChangedAsync(key, json, cancellationToken).ConfigureAwait(false);
        return pages;
    }
}
