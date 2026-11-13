# Backend

Everything behind the browser, end to end: how a request travels, how the .NET API is built, how the Node worker runs
tests, where data lives, and how to change any of it. For the browser side, see [FRONTEND.md](FRONTEND.md).

## 1. The big picture

QA Studio is a generic, data-driven web test platform. Test cases are data: imported from Excel or written in the app.
Their runnable steps are edited visually and stored in the database, and one generic runner executes any of them with
Playwright. Nothing is written in code per application or per test case.

```
Browser ──► QaStudio.Api (.NET 10, 127.0.0.1:5080) ──► SQL Server
            │  Projects, Test suites, Test cases, Audit      ▲
            │  Security checks; serves the built frontend    │ POST /internal/persistence/batch
            │                                                │ GET  /internal/persistence/snapshot
            └─ Forwards every other /api route ──► Node worker (127.0.0.1:4000)
                                                   Playwright, Excel, step library, AI, live events
```

- **The API is the only address the browser uses.** A route implemented in .NET wins over the gateway's catch-all, so
  routes can move from the worker to .NET one at a time.
- **SQL Server is the only copy of the data.** The worker holds a copy in memory and writes every change through the API.
- **Why two runtimes:** see [adr/0005](adr/0005-sql-server-and-dotnet-api.md).

## 2. Run it

Requires the .NET 10 SDK, the EF Core tools, Node.js 22.13+ and SQL Server. First-time setup and every setting:
[Backend/README.md](../Backend/README.md). Then `Backend\qa-studio.cmd`, or `npm start` in `Backend/Worker`.

## 3. The .NET API

### Layers

Dependencies point inward only. See [adr/0007](adr/0007-cqrs-and-ddd-structure.md) for why.

```
src/API             HTTP only: endpoints, security, error shape, gateway to the worker
src/Application     Use cases: commands, queries, handlers, and the interfaces they need
src/Infrastructure  EF Core (writes, migrations), Dapper (flat reads, aggregates), repositories, cache, worker client
src/Core            The domain: entities, rules, errors. Depends on nothing.
```

### Folder structure

Every use case has its own folder, in both layers, with the same name. One type per file.

```
src/Application/Features/
  Projects/
    Common/          ProjectResponse, ProjectResponseBuilder (shared by this feature's use cases)
    CreateProject/   CreateProjectCommand, CreateProjectHandler
    UpdateProject/   UpdateProjectCommand, UpdateProjectHandler
    DeleteProject/   DeleteProjectCommand, DeleteProjectHandler
    GetProject/      GetProjectQuery, GetProjectHandler
    ListProjects/    ListProjectsQuery, ListProjectsHandler
  TestSuites/  TestCases/  Audit/  WorkerState/

src/API/Endpoints/
  Projects/
    CreateProject/   CreateProjectEndpoint, CreateProjectRequest
    ...
  TestSuites/  TestCases/  Audit/  Auth/  Health/  WorkerState/
```

A use case has its own `...Response` when its answer is its own, such as `DeleteTestCasesResponse`. When every use case
of a feature answers with the same shape, that one type lives in the feature's `Common` folder, so it is never duplicated.

### How a request travels

```
POST /api/projects
  CreateProjectEndpoint      translates HTTP to a command; nothing else
  IDispatcher                finds the handler and wraps it in the behaviors
    LoggingBehavior          times the request; never logs its content
    ValidationBehavior       runs the request's validators, if it has any
    CreateProjectHandler     the use case
      Project.Create()       the domain refuses bad values, naming every wrong field
      IProjectRepository     queues the change
      MasterDataCommit       commits, drops the cache, tells open pages
  ApiExceptionHandler        turns any failure into { error: { code, message, fields } }
```

### CQRS

- **Commands** (`ICommand<T>`) change state, through repositories and `IUnitOfWork`.
- **Queries** (`IQuery<T>`) only read. Test cases use EF compiled/split no-tracking queries (`ITestCaseReader`); master data
  lists (`IMasterDataReader`: projects, suites, versions), library counts (`IInsightsReader`, `GET /api/insights`) the dashboard (`IDashboardReader`, `GET /api/dashboard`) and the run history (`IRunReader`, `GET /api/runs`) use
  **Dapper** with hand-written SQL. Master data reads are cached by a decorator, and the cache is dropped after every change. Why both
  ORMs: [adr/0008](adr/0008-dapper-read-side.md).
- The dispatcher is a small in-house mediator. Handlers, validators and endpoints are found by scanning the assemblies, so
  adding one needs no registration.

### Domain-driven design (`src/Core`)

**Entities cannot exist in an invalid state.** Factories and update methods check every rule and refuse with
`DomainValidationException`, which reports all wrong fields together. So these rules hold for every path in, including
the worker's imports, and are not repeated anywhere.

| Building block  | Where                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Aggregate roots | `Project`, `TestSuite`, `TestCase` (with its `TestCaseStep`s), based on `AuditableEntity<TId>`                                    |
| Value objects   | `TestCaseContent`, `TestCaseSource`                                                                                               |
| Domain rules    | `DomainRules` collects broken rules; `Project.EnsureCanBeDeleted`, `TestSuite.EnsureCanBeDeleted` keep delete rules in the domain |
| Domain service  | `CaseCodeGenerator`                                                                                                               |
| Domain errors   | `ProjectErrors`, `TestSuiteErrors`, `TestCaseErrors`                                                                              |
| Documents       | `Core/Automation`: scenarios, runs, accounts and so on. The worker owns their content; the domain guards what the columns hold    |

**What belongs where:** a rule about what makes an entity valid is the domain's. A rule about the request itself (an ID
was chosen, a list is not too long) is a FluentValidation validator in the use case's folder, run before the handler.

### Patterns in use

| Pattern              | Where, and why                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Dependency injection | Everything. `AddApplication`, `AddInfrastructure`, `AddApiCommon`, `AddApiSecurity`                                       |
| Repository           | `IRepository<T>` and `EfRepository<T, TId>` hold what all aggregates share; each aggregate's interface adds its own reads |
| Unit of work         | `IUnitOfWork` commits one request as one transaction and turns SQL refusals into conflicts                                |
| Strategy             | `IWorkerOperationHandler`: each family of worker writes is a class in `WorkerState/ApplyWorkerOperations/Strategies`      |
| Decorator            | `CachedMasterDataReader`, and the pipeline behaviors around every handler                                                 |
| Mediator             | `IDispatcher`, so endpoints depend on no concrete handler                                                                 |
| Options              | `DatabaseOptions`, `WorkerOptions`, `SecurityOptions`, `LimitsOptions`, each checked at start-up where it has ranges      |

### Constants

No important key is written twice. `ErrorCodes` (what the frontend branches on), `FieldNames` (what forms bind errors to),
`AuditActions`, `WorkerOperationKinds`, `ScenarioSlotNames`, `TestCaseReadiness`, `DocumentLimits` and the length constants
on each entity (shared by its rules and its table mapping), and `ApiRoutes` and `ApiTags`.

### Add a use case

1. If it needs a new rule, add it to the entity in `src/Core`, with a unit test.
2. Create `Application/Features/<Feature>/<UseCase>/` with the command or query and its handler. Add a validator only for
   rules about the request itself. All are found automatically.
3. Create `API/Endpoints/<Feature>/<UseCase>/` with an `IEndpoint` class, and a request type if it has a body. Add the
   route to `ApiRoutes`.
4. A handler that changes projects or suites commits through `MasterDataCommit`, and one that saves a test case through
   `TestCaseCommit`, so the cache and the worker hear about it.
5. If it needs a new worker write, add a kind to `WorkerOperationKinds` and handle it in a strategy. A unit test fails if
   a kind has no strategy.

## 4. The Node worker

`Backend/Worker` runs tests and everything else that is not storage. It has no data of its own on disk, apart from run
evidence and the encryption key.

```
services/qa-api              HTTP routes → services → storage
services/qa-mcp              MCP tools for AI assistants: see AI-AND-MCP.md
packages/automation-core     generic step library, element finder, converter, sign-in
packages/execution-engine    Playwright executor, run manager
packages/test-case-import    Excel parsing, column detection, templates
packages/shared              schemas and types shared by everything (zod)
packages/reporting           HTML, Excel and JSON reports
packages/llm, agents, knowledge   AI providers, agents, local search index
```

Its main modules are in `services/qa-api/src`:

| Module                                  | Responsibility                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| `app.ts`                                | HTTP routes, request validation, error shape                                               |
| `remote-storage.ts`, `internal-sync.ts` | Reads from memory, writes to the API in order; hears about changes made through the API    |
| `project-connections.ts`                | Each project's address, environment and sign-in; what a run of that project uses           |
| `accounts.ts`                           | Test accounts of each project. Passwords are encrypted and never leave this class          |
| `scenario-service.ts`                   | Draft → validated → approved lifecycle, revisions, restore, clear                          |
| `conversions.ts`                        | Background conversion of imported cases, with per-case outcome and counts                  |
| `parameters.ts`                         | Per-case `{{data.name}}` values; auto-fill (old values → AI → name-based guess)            |
| `azure-devops.ts`                       | Azure Test Plans: connection, import, automated pipeline, result publishing                |
| `page-map.ts`                           | Settings › Pages: shared list plus per-project lists; a run uses its project's merged list |
| `backups.ts`                            | Snapshots before clearing, restore, 7-day retention                                        |
| `settings-service.ts`                   | Install-wide execution settings                                                            |
| `ai-service.ts`, `ai-tasks.ts`          | AI provider and jobs                                                                       |

**How it stays correct without a local database.** Its services are synchronous, so `RemoteStorage` keeps a private
in-memory copy for reads, loaded from the API at start-up, and sends every write to the API in order. A request that
changed something is not answered until its writes have committed. If the database cannot take them, the person gets a
503, and the writes stay queued and are retried. A write refused as invalid is dropped and logged, so it cannot block
later ones. Run one API and one worker per database.

## 5. From Excel to a result

1. **Import.** `POST /api/imports` parses the workbook. Columns are detected from header names, or mapped by hand.
   `POST /api/imports/:id/commit` adds the cases. Each module becomes a suite in the General project.
2. **Convert.** `POST /api/conversions` runs the rule-based converter over each case's written steps as a background job.
   Results are drafts, and progress is published as live events.
3. **Review.** `PUT /api/scenarios/:caseId` saves a person's edit: valid steps become the approved version, and steps with
   problems stay a draft. AI drafts go through the same review. Step format: [STEP-FORMAT.md](STEP-FORMAT.md).
4. **Run.** `POST /api/runs/plan` says what the chosen cases need, by project. `POST /api/runs` signs in once per chosen
   account, then runs each approved scenario with the generic actions.
5. **Report.** `GET /api/runs/:id/report.{json,html,xlsx}` builds one report and renders it three ways.

More on Test Case Studio, parameters, versions and Azure DevOps: [TEST-CASES-AND-IMPORTS.md](TEST-CASES-AND-IMPORTS.md) and
[adr/0009](adr/0009-case-parameters-versions-azure-devops.md).

## 6. Runs

- **Each case runs against its own project's** application address, environment and sign-in. A run may span projects: a
  case signs in only as chosen accounts of its own project, and a run touching a project that is not set up is refused,
  naming it. See [adr/0006](adr/0006-per-project-connection.md). Browser, workers and timeouts are install-wide.
- Runs execute one at a time. Cases within a run execute in parallel, up to the configured workers (at most 16).
- One fresh browser per case. Sign-in happens before tracing starts, because a trace records typed values. Actions never
  receive credentials.
- **Case status:** `blocked` (no scenario, unknown action, bad parameters, destructive not allowed, sign-in not possible),
  `failed`, `passed`, `cancelled`. After a failed sign-in, the run stops trying that account, to avoid locking it out.
- **Failure kinds:** `assertion` (the app did not behave as expected), `timeout`, `automation-error`, `blocked`,
  `cancelled`. The engine cannot yet tell an application defect from an outage: both can surface as `timeout`.
- **Run status** is `failed` if any case failed or is blocked. Pass rate = passed / (passed + failed); blocked, skipped and
  cancelled are excluded and shown separately.
- **Evidence** (screenshot, page text, trace) is saved only for failures, under `artifacts/<runId>/<case>/`. The API serves
  only files a run reported.
- **After a restart,** a run that was queued or running is closed as `cancelled` with the reason "Interrupted by a server
  restart."; cases that already finished keep their results.
- **Reports:** test case text is untrusted Excel content. HTML escapes every value, has no scripts and a `default-src 'none'`
  CSP; Excel cells starting with `= + - @` are prefixed with an apostrophe; secrets are redacted.
- **Dashboard** (`GET /api/dashboard?projectId=&versionId=`, served by this API from the database since stage 1 of
  [adr/0010](adr/0010-moving-worker-features-to-dotnet.md)): latest result per case (a cancelled run never overrides earlier
  evidence), coverage, pass-rate trend over the last 20 finished runs, high-priority failures, and recent activity. The rules are
  the pure `DashboardBuilder` (unit tests), the SQL is `DashboardReader` (Dapper). Library counts: `GET /api/insights?days=30`.
- **Parameters:** a case's `{{data.name}}` values are rows in `CaseParameterValues` (its own) and `ProjectParameterValues` (shared by
  the project); a case's own value wins, then the project's, else the name is missing and the case is blocked before any step.
  The API owns them (`ParameterViews`, `ParameterRules`, `ParameterSuggester`, `GuessValue`): reading, saving, suggesting and
  auto-fill are `/api/parameters…`. When a run starts the worker asks the API for the chosen cases' values
  (`POST /internal/persistence/parameters/effective`) and refuses the run if it cannot get them; backups, "clear all data" and the
  Azure DevOps pipeline's auto-fill also go through the API. Only the AI call stays in the worker
  (`POST /internal/parameters/ai-suggest`). See [adr/0011](adr/0011-parameter-values-in-tables.md).
- **Pages:** a case's steps see the shared page list overlaid with its own project's pages. The lists are edited through the API
  (`GET/PUT /api/pages`, `PageList` rules, config blocks `pages` and `pages:<projectId>`); the worker only reads them, taking a change
  from the API's notice and again from the database before each run ([adr/0010](adr/0010-moving-worker-features-to-dotnet.md)).
- **Concurrent users:** choosing several accounts runs each case once per account in parallel (Test Execution › Concurrent run sets
  one browser per job, at most 16).

## 7. Where data lives

- **SQL Server:** projects, suites, test cases, scenarios with every earlier version, runs, accounts (ciphertext), project
  connections and settings, the page lists, project versions, per-case parameters, the Azure DevOps connection (token as
  ciphertext), backups and the audit log. Schema and performance:
  [DATABASE.md](DATABASE.md).
- **Run evidence:** files under `QA_ARTIFACTS_DIR`.
- **`Backend/Worker/data/secret.key`** decrypts stored passwords, sessions and AI keys. It is kept apart from the database
  on purpose. Back it up separately: without it, stored secrets are unreadable.

## 8. Safety rules enforced in code

- A step that changes or deletes data only runs when `QA_ALLOW_DESTRUCTIVE=true`; otherwise the whole case is blocked
  before any step runs.
- Only environments on the allow-list (`QA_ALLOWED_ENVS`, read from the environment only) can be tested, and addresses that
  look like production, or that carry a username or password, are refused.
- Sign-in happens in the runner, never in a step.
- Passwords and API keys are write-only, and are never sent to an AI model or written to logs, results or the audit log.
- Nothing AI or the converter writes runs until a person approves it.
- `/internal` routes refuse everything unless the shared secret is configured and matches. `/api` routes check the Host and
  Origin headers, and the access token when one is set.
- A project with suites or test accounts, and a suite holding test cases, cannot be deleted.

## 9. Errors

Every failure has the same shape, whichever runtime answers:

```json
{
  "error": {
    "code": "duplicate-code",
    "message": "A readable message.",
    "fields": { "code": "Beside the field." }
  }
}
```

`400` for bad input, `404` for something missing, `409` for a duplicate, a stale edit or a refused delete, `503` when the
worker or database cannot be reached. `code` is stable, and the frontend branches on it.

## 10. Quality

```bash
dotnet build Backend/QaStudio.sln
```

```bash
dotnet test Backend/QaStudio.sln
```

```bash
npm run check --prefix Backend/Worker
```

- **The .NET build fails on any warning,** including SonarQube's rules (`SonarAnalyzer.CSharp` runs in every build) and
  unused usings. `Backend/.editorconfig` switches on the Sonar rules that take a threshold, such as S107 and S3776.
- **Integration tests** run the real API against a throw-away `QaStudio_Test_<guid>` database, created and dropped by the
  test run. They refuse to start on anything else, so they cannot touch real data.
- **The worker's tests** include real-browser ones, and need no model: the AI sits behind an interface with a fake.
- **CI** (`Backend/azure-pipelines.yml`) builds the solution and runs .NET unit tests, then format, type check, lint, tests,
  build and `npm audit` for the worker and frontend. Integration tests need SQL Server, so CI does not run them. The pipeline
  has not been run on Azure DevOps yet.
- **Accepted audit finding:** 2 moderate, `uuid` inside `exceljs`. The advisory concerns uuid v3/v5/v6 with an output buffer;
  `exceljs` only calls `uuidv4()` without one, so it is not reachable. Revisit when exceljs updates.

## 11. Known limits

- The Azure DevOps pipeline runs one at a time and is not resumed after a worker restart; shared steps (`compref`) are imported as
  one placeholder step that names the shared work item.
- The AI assistant's "explore" uses the first project that is set up.
- The worker holds every test case in memory, and the UI loads them all, which is comfortable to roughly 10,000–20,000 cases.
- Actions marked `legacy-csharp` came from an old suite and are tested only against a local stub app.
- SonarAnalyzer covers the C# code. The TypeScript in the worker and frontend is checked by ESLint and `tsc`, not by Sonar.
