using System.Globalization;
using System.Text.RegularExpressions;
using QaStudio.Application.Abstractions;

namespace QaStudio.Application.Features.Dashboard.GetDashboard;

/// <summary>
/// Summarises the test library and its run history for the dashboard. Pure: it reads nothing and changes nothing, so
/// every rule below is covered by plain unit tests.
/// </summary>
/// <remarks>
/// "With scenario" means an approved scenario is mapped; it does not mean the case passes or is reliable. A case's result
/// is its most recent finished result across the given runs. A case run as several accounts is only as good as its worst
/// account, so one account's pass never hides another account's failure.
/// </remarks>
public static class DashboardBuilder
{
    /// <summary>The most finished runs on the trend.</summary>
    public const int TrendLimit = 20;

    /// <summary>The most recent runs listed.</summary>
    public const int RecentLimit = 8;

    /// <summary>The most cells on the coverage map.</summary>
    public const int MapLimit = 1500;

    private const string NoModule = "(no module)";
    private const string Passed = "passed";
    private const string Failed = "failed";
    private const string Blocked = "blocked";
    private const string NotRun = "notRun";

    private static readonly Regex HighPriority = new(
        "^(critical|blocker|high|p0|p1|1)$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant,
        TimeSpan.FromSeconds(1));

    // Failed beats blocked beats passed.
    private static readonly Dictionary<string, int> Rank = new(StringComparer.Ordinal) { [Failed] = 3, [Blocked] = 2, [Passed] = 1 };

    // Cancelled results are deliberately absent: a cancelled run must not erase earlier evidence.
    private static readonly HashSet<string> Evidence = new(StringComparer.Ordinal) { Passed, Failed, Blocked };

    private static readonly string[] Definitions =
    [
        "Results use each test case's most recent finished result across stored runs.",
        "Pass rate = passed / (passed + failed). Blocked, cancelled and not-run cases are excluded and shown separately.",
        "The trend plots finished runs only (passed or failed); cancelled and in-progress runs are partial and are left out.",
        "\"With scenario\" means an approved scenario is mapped. It does not mean the case is reliable or passing.",
        "High-priority failures are failed cases whose priority text is Critical, Blocker, High, P0, P1 or 1.",
        "Inventory and runs are counted only for cases currently in the inventory; runs of removed cases are ignored for case counts.",
    ];

    private sealed record Latest(string Status, string RunId, string Message);

    /// <summary>Builds the dashboard.</summary>
    /// <param name="input">The cases, runs and approved scenarios.</param>
    /// <returns>The dashboard.</returns>
    public static DashboardData Build(DashboardInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var runs = Narrow(input);
        var latest = LatestResults(runs);

        var tally = new Tally();
        foreach (var tc in input.Cases)
        {
            latest.TryGetValue(tc.Code, out var l);
            tally.Add(tc, l, input.ApprovedCaseCodes.Contains(tc.Code));
        }

        // Cancelled runs are partial, so their pass rate would mislead; they still show under recent activity.
        var finished = runs.Where(r => r.Status is Passed or Failed).ToList();
        var order = StringComparer.Create(CultureInfo.InvariantCulture, ignoreCase: false);
        return new DashboardData
        {
            Totals = new DashboardTotals(
                input.Cases.Count,
                input.Cases.Count(c => input.ApprovedCaseCodes.Contains(c.Code)),
                input.Cases.Count(c => !input.ApprovedCaseCodes.Contains(c.Code))),
            Latest = new LatestCounts(tally.PassedTotal, tally.FailedTotal, tally.BlockedTotal, tally.NotRunTotal, Rate(tally.PassedTotal, tally.FailedTotal)),
            Modules =
            [
                .. tally.Modules
                    .OrderBy(m => m.Key, order)
                    .Select(m => new ModuleRow(m.Key, m.Value.CaseCount, m.Value.ScenarioCount, m.Value.PassedCount, m.Value.FailedCount, m.Value.BlockedCount, m.Value.NotRunCount)),
            ],
            Map = [.. tally.Cells.OrderBy(c => c.Key, order).Select(c => new MapModule(c.Key, c.Value))],
            MapTruncated = input.Cases.Count > MapLimit,
            Trend = [.. finished.TakeLast(TrendLimit).Select(TrendOf)],
            RecentRuns = [.. Enumerable.Reverse(runs).Take(RecentLimit).Select(RecentOf)],
            HighPriorityFailures = tally.Failures,
            Definitions = Definitions,
        };
    }

    /// <summary>
    /// Runs oldest first. A run records no project, so a narrowed dashboard keeps only the results of the cases in scope
    /// and drops a run that has none left.
    /// </summary>
    private static List<DashboardRun> Narrow(DashboardInput input)
    {
        IEnumerable<DashboardRun> runs = input.Runs;
        if (input.Scoped)
        {
            var inScope = input.Cases.Select(c => c.Code).ToHashSet(StringComparer.Ordinal);
            runs = runs
                .Select(r => r with { Results = [.. r.Results.Where(x => inScope.Contains(x.CaseCode))] })
                .Where(r => r.Results.Count > 0);
        }

        return [.. runs.OrderBy(r => Parse(r.CreatedAt))];
    }

    private static Dictionary<string, Latest> LatestResults(List<DashboardRun> runs)
    {
        // case -> account -> that account's most recent result. A case run as several accounts has several.
        var perAccount = new Dictionary<string, Dictionary<string, Latest>>(StringComparer.Ordinal);
        foreach (var run in runs)
        {
            foreach (var c in run.Results.Where(x => Evidence.Contains(x.Status)))
            {
                if (!perAccount.TryGetValue(c.CaseCode, out var byAccount))
                {
                    byAccount = new Dictionary<string, Latest>(StringComparer.Ordinal);
                    perAccount[c.CaseCode] = byAccount;
                }

                var message = (c.FailureMessage ?? string.Empty)
                    + (!string.IsNullOrEmpty(c.Account) && c.FailureMessage is not null ? $" (as {c.Account})" : string.Empty);
                byAccount[c.Account ?? string.Empty] = new Latest(c.Status, run.Id, message);
            }
        }

        var latest = new Dictionary<string, Latest>(StringComparer.Ordinal);
        foreach (var (caseCode, byAccount) in perAccount)
        {
            var worst = byAccount.Values.OrderByDescending(a => Rank.GetValueOrDefault(a.Status)).FirstOrDefault();
            if (worst is not null)
            {
                latest[caseCode] = worst;
            }
        }

        return latest;
    }

    private static TrendPoint TrendOf(DashboardRun r)
    {
        var s = Summarize(r);
        return new TrendPoint(r.Id, r.StartedAt ?? r.CreatedAt, s.Passed, s.Failed, s.Blocked, s.Total, s.PassRate);
    }

    private static RecentRun RecentOf(DashboardRun r) =>
        new(r.Id, r.Status, r.StartedAt ?? r.CreatedAt, r.Environment, r.Results.Count, Summarize(r).PassRate);

    private static (int Passed, int Failed, int Blocked, int Total, double? PassRate) Summarize(DashboardRun r)
    {
        var passed = r.Results.Count(x => x.Status == Passed);
        var failed = r.Results.Count(x => x.Status == Failed);
        var blocked = r.Results.Count(x => x.Status == Blocked);
        return (passed, failed, blocked, r.Results.Count, Rate(passed, failed));
    }

    private static double? Rate(int passed, int failed) => passed + failed == 0 ? null : (double)passed / (passed + failed);

    // Stored as ISO text; unreadable text sorts first rather than breaking the dashboard.
    private static DateTimeOffset Parse(string iso) =>
        DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var at) ? at : DateTimeOffset.MinValue;

    private sealed class ModuleCounts
    {
        public int CaseCount { get; set; }

        public int ScenarioCount { get; set; }

        public int PassedCount { get; set; }

        public int FailedCount { get; set; }

        public int BlockedCount { get; set; }

        public int NotRunCount { get; set; }
    }

    /// <summary>Counts each case into the totals, its module and the coverage map.</summary>
    private sealed class Tally
    {
        public int PassedTotal { get; private set; }

        public int FailedTotal { get; private set; }

        public int BlockedTotal { get; private set; }

        public int NotRunTotal { get; private set; }

        public Dictionary<string, ModuleCounts> Modules { get; } = new(StringComparer.Ordinal);

        public Dictionary<string, List<MapCell>> Cells { get; } = new(StringComparer.Ordinal);

        public List<PriorityFailure> Failures { get; } = [];

        private int _cellCount;

        public void Add(DashboardCase tc, Latest? latest, bool hasScenario)
        {
            var key = tc.Module ?? NoModule;
            if (!Modules.TryGetValue(key, out var row))
            {
                row = new ModuleCounts();
                Modules[key] = row;
            }

            row.CaseCount++;
            row.ScenarioCount += hasScenario ? 1 : 0;
            Count(row, latest);
            NoteFailure(tc, latest);
            if (_cellCount >= MapLimit)
            {
                return;
            }

            _cellCount++;

            if (!Cells.TryGetValue(key, out var list))
            {
                list = [];
                Cells[key] = list;
            }

            list.Add(new MapCell(tc.Code, latest?.Status ?? NotRun, hasScenario));
        }

        private void Count(ModuleCounts row, Latest? latest)
        {
            switch (latest?.Status)
            {
                case null:
                    NotRunTotal++;
                    row.NotRunCount++;
                    break;
                case Passed:
                    PassedTotal++;
                    row.PassedCount++;
                    break;
                case Failed:
                    FailedTotal++;
                    row.FailedCount++;
                    break;
                default:
                    BlockedTotal++;
                    row.BlockedCount++;
                    break;
            }
        }

        private void NoteFailure(DashboardCase tc, Latest? latest)
        {
            if (latest?.Status == Failed && !string.IsNullOrEmpty(tc.Priority) && HighPriority.IsMatch(tc.Priority))
            {
                Failures.Add(new PriorityFailure(tc.Code, tc.Title, tc.Module, tc.Priority, latest.RunId, latest.Message));
            }
        }
    }
}
