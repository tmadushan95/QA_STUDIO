using QaStudio.Application.Abstractions;
using QaStudio.Core.MasterData;

namespace QaStudio.Application.Features.WorkerState.ApplyWorkerOperations;

/// <summary>
/// Files a test case that arrives without a suite (imports, AI, a restored backup). Its module becomes a suite in the
/// chosen project, or the default project when none was chosen, so imported workbooks arrive categorised.
/// </summary>
/// <param name="projects">Project repository.</param>
/// <param name="suites">Suite repository.</param>
/// <param name="clock">Clock.</param>
internal sealed class DefaultSuiteResolver(IProjectRepository projects, ITestSuiteRepository suites, IClock clock)
{
    private readonly Dictionary<string, TestSuite> _resolved = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<int, Project> _chosen = [];
    private Project? _project;

    /// <summary>Finds or creates the suite for a module.</summary>
    /// <param name="module">The case's module, if any.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The suite; it may not be saved yet.</returns>
    public Task<TestSuite> ResolveAsync(string? module, CancellationToken cancellationToken) =>
        ResolveAsync(module, null, cancellationToken);

    /// <summary>Finds or creates the suite for a module inside a chosen project (the default project when null or gone).</summary>
    /// <param name="module">The case's module, if any.</param>
    /// <param name="projectId">The project chosen for the case.</param>
    /// <param name="cancellationToken">Cancels the work.</param>
    /// <returns>The suite; it may not be saved yet.</returns>
    public async Task<TestSuite> ResolveAsync(string? module, int? projectId, CancellationToken cancellationToken)
    {
        var name = string.IsNullOrWhiteSpace(module) ? TestSuite.UnassignedName : module.Trim();
        if (projectId is > 0)
        {
            var chosen = await ChosenAsync(projectId.Value, cancellationToken).ConfigureAwait(false);
            if (chosen is not null)
            {
                var key = $"{chosen.Id}\u001f{name}";
                if (_resolved.TryGetValue(key, out var inProject))
                {
                    return inProject;
                }

                var found = await suites.FindByNameAsync(chosen.Id, name, cancellationToken).ConfigureAwait(false)
                    ?? AddSuite(chosen, name);
                _resolved[key] = found;
                return found;
            }
        }

        if (_resolved.TryGetValue(name, out var known))
        {
            return known;
        }

        var now = clock.UtcNow;
        _project ??= await projects.FindByCodeAsync(Project.DefaultCode, cancellationToken).ConfigureAwait(false);
        if (_project is null)
        {
            _project = Project.Create(Project.DefaultCode, Project.DefaultName, Project.DefaultDescription, now);
            projects.Add(_project);
        }

        var suite = _project.Id == 0 ? null : await suites.FindByNameAsync(_project.Id, name, cancellationToken).ConfigureAwait(false);
        if (suite is null)
        {
            suite = TestSuite.CreateUnder(_project, name, now);
            suites.Add(suite);
        }

        _resolved[name] = suite;
        return suite;
    }

    private async Task<Project?> ChosenAsync(int projectId, CancellationToken cancellationToken)
    {
        if (_chosen.TryGetValue(projectId, out var cached))
        {
            return cached;
        }

        var project = await projects.FindAsync(projectId, cancellationToken).ConfigureAwait(false);
        if (project is not null)
        {
            _chosen[projectId] = project;
        }

        return project;
    }

    private TestSuite AddSuite(Project project, string name)
    {
        var suite = TestSuite.CreateUnder(project, name, clock.UtcNow);
        suites.Add(suite);
        return suite;
    }
}
