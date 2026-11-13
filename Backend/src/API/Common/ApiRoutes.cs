namespace QaStudio.Api.Common;

/// <summary>Every route this API answers itself, in one place. Anything else under /api goes on to the worker.</summary>
internal static class ApiRoutes
{
    /// <summary>The project list.</summary>
    public const string Projects = "/api/projects";

    /// <summary>One project.</summary>
    public const string Project = Projects + "/{id:int}";

    /// <summary>The test suite list.</summary>
    public const string TestSuites = "/api/test-suites";

    /// <summary>One test suite.</summary>
    public const string TestSuite = TestSuites + "/{id:int}";

    /// <summary>The project version list.</summary>
    public const string ProjectVersions = "/api/project-versions";

    /// <summary>One project version.</summary>
    public const string ProjectVersion = ProjectVersions + "/{id:int}";

    /// <summary>Library counts for the dashboard.</summary>
    public const string Insights = "/api/insights";

    /// <summary>Parameter summary of every case.</summary>
    public const string Parameters = "/api/parameters";

    /// <summary>One case's parameters.</summary>
    public const string CaseParameters = Parameters + "/{caseId}";

    /// <summary>Fill the missing parameters of many cases.</summary>
    public const string ParametersAuto = Parameters + "/auto";

    /// <summary>Suggested values for one case's missing parameters.</summary>
    public const string CaseParametersSuggest = CaseParameters + "/suggest";

    /// <summary>Suggested values for a project's empty common parameters.</summary>
    public const string CommonParametersSuggest = Parameters + "/common/{projectId:int}/suggest";

    /// <summary>A project's common parameters.</summary>
    public const string CommonParameters = Parameters + "/common/{projectId:int}";

    /// <summary>The page list (shared, or one project's own).</summary>
    public const string Pages = "/api/pages";

    /// <summary>The run history.</summary>
    public const string Runs = "/api/runs";

    /// <summary>One run.</summary>
    public const string Run = Runs + "/{id}";

    /// <summary>Results, coverage and trend for the dashboard.</summary>
    public const string Dashboard = "/api/dashboard";

    /// <summary>The test case list.</summary>
    public const string TestCases = "/api/test-cases";

    /// <summary>One test case.</summary>
    public const string TestCase = TestCases + "/{caseId}";

    /// <summary>The next free case ID.</summary>
    public const string NextCaseId = TestCases + "/next-id";

    /// <summary>Deleting test cases.</summary>
    public const string DeleteTestCases = TestCases + "/delete";

    /// <summary>Moving test cases.</summary>
    public const string MoveTestCases = TestCases + "/move";

    /// <summary>Giving test cases a project version.</summary>
    public const string AssignTestCasesVersion = TestCases + "/assign-version";

    /// <summary>The audit trail.</summary>
    public const string Audit = "/api/audit";

    /// <summary>The health check.</summary>
    public const string Health = "/api/health";

    /// <summary>Whether this request is signed in.</summary>
    public const string AuthStatus = "/api/auth/status";

    /// <summary>Signing in.</summary>
    public const string Login = "/api/auth/login";

    /// <summary>Signing out.</summary>
    public const string Logout = "/api/auth/logout";

    /// <summary>Everything the worker loads when it starts.</summary>
    public const string WorkerSnapshot = "/internal/persistence/snapshot";

    /// <summary>Every test case, for the worker's refresh before a run.</summary>
    public const string WorkerTestCases = "/internal/persistence/test-cases";

    /// <summary>Parameter values for the worker (effective values for a run, export, import, clear, auto-fill).</summary>
    public const string WorkerParameters = "/internal/persistence/parameters";

    /// <summary>Configuration blocks for the worker.</summary>
    public const string WorkerConfig = "/internal/persistence/config";

    /// <summary>The worker's writes.</summary>
    public const string WorkerBatch = "/internal/persistence/batch";
}
