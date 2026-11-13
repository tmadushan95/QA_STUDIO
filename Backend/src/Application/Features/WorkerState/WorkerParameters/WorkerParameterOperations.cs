using QaStudio.Application.Abstractions;
using QaStudio.Core.Automation;

namespace QaStudio.Application.Features.WorkerState.WorkerParameters;

/// <summary>The values a run should use for the given cases: each case's own value over its project's common one.</summary>
/// <param name="CaseCodes">The cases about to run.</param>
public sealed record GetEffectiveParametersQuery(IReadOnlyList<string> CaseCodes) : IQuery<IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>>;

/// <summary>Every case's own values, for a backup.</summary>
public sealed record ExportParametersQuery : IQuery<IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>>;

/// <summary>Puts a backup's values back: each case in it gets exactly the values in it; other cases are left alone.</summary>
/// <param name="Values">Case to name to value.</param>
public sealed record ImportParametersCommand(IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> Values) : ICommand<int>;

/// <summary>Removes every case's own values ("clear all data"); project common values are kept.</summary>
public sealed record ClearParametersCommand : ICommand<int>;

/// <summary>Handles <see cref="GetEffectiveParametersQuery"/>.</summary>
/// <param name="cases">Reads the projects of the cases.</param>
/// <param name="store">The parameter values.</param>
internal sealed class GetEffectiveParametersHandler(IParameterCaseReader cases, IParameterStore store) : IRequestHandler<GetEffectiveParametersQuery, IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>>
{
    public async Task<IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>> HandleAsync(GetEffectiveParametersQuery request, CancellationToken cancellationToken)
    {
        var codes = request.CaseCodes.Distinct(StringComparer.Ordinal).ToList();
        var projects = await cases.ReadProjectsAsync(codes, cancellationToken).ConfigureAwait(false);
        var own = await store.GetCasesAsync(codes, cancellationToken).ConfigureAwait(false);
        var common = await store.GetProjectsAsync([.. projects.Values.Distinct()], cancellationToken).ConfigureAwait(false);
        var result = new Dictionary<string, IReadOnlyDictionary<string, string>>(StringComparer.Ordinal);
        foreach (var code in codes)
        {
            var values = new Dictionary<string, string>(StringComparer.Ordinal);
            if (projects.TryGetValue(code, out var project) && common.TryGetValue(project, out var shared))
            {
                foreach (var (name, value) in shared)
                {
                    values[name] = value;
                }
            }

            if (own.TryGetValue(code, out var mine))
            {
                foreach (var (name, value) in mine)
                {
                    values[name] = value;
                }
            }

            result[code] = values;
        }

        return result;
    }
}

/// <summary>Handles <see cref="ExportParametersQuery"/>.</summary>
/// <param name="store">The parameter values.</param>
internal sealed class ExportParametersHandler(IParameterStore store) : IRequestHandler<ExportParametersQuery, IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>>
{
    public Task<IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>> HandleAsync(ExportParametersQuery request, CancellationToken cancellationToken) =>
        store.GetCasesAsync(null, cancellationToken);
}

/// <summary>Handles <see cref="ImportParametersCommand"/>.</summary>
/// <param name="store">The parameter values.</param>
/// <param name="unitOfWork">Commits the change.</param>
/// <param name="clock">Clock.</param>
internal sealed class ImportParametersHandler(IParameterStore store, IUnitOfWork unitOfWork, IClock clock) : IRequestHandler<ImportParametersCommand, int>
{
    public async Task<int> HandleAsync(ImportParametersCommand request, CancellationToken cancellationToken)
    {
        var imported = 0;
        foreach (var (code, values) in request.Values)
        {
            // A backup is trusted, but a value the tables could not hold is left out rather than failing the restore.
            var usable = values
                .Where(v => v.Key.Length is > 0 and <= ParameterLimits.NameMaxLength && v.Value.Length is > 0 and <= ParameterLimits.ValueMaxLength)
                .Take(ParameterLimits.MaxPerCase)
                .ToDictionary(v => v.Key, v => v.Value, StringComparer.Ordinal);
            await store.ReplaceCaseAsync(code, usable, clock.UtcNow, cancellationToken).ConfigureAwait(false);
            imported++;
        }

        await unitOfWork.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return imported;
    }
}

/// <summary>Handles <see cref="ClearParametersCommand"/>.</summary>
/// <param name="store">The parameter values.</param>
internal sealed class ClearParametersHandler(IParameterStore store) : IRequestHandler<ClearParametersCommand, int>
{
    public Task<int> HandleAsync(ClearParametersCommand request, CancellationToken cancellationToken) =>
        store.DeleteAllCasesAsync(cancellationToken);
}
