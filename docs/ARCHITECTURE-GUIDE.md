# QA Studio: the architecture guide for new developers

This guide explains the whole system from the top, in plain words, with one real example followed end to end. Read it once
from start to finish, then use the other documents (linked at the end) for detail.

**How to read it:** every section starts with the idea, then shows where it lives in the code. Where a design pattern is used,
the pattern's name is in **bold** the first time, so you can look it up. Section 9 lists them all in one table.

---

## 1. What QA Studio does

QA Studio manages **test cases** for web applications and **runs them automatically** in a real browser.

1. A tester creates test cases (by hand, from Excel, from Azure DevOps, or with AI).
2. Each case is turned into **steps** ("open this page", "click this button", "check this text is shown").
3. A person presses Run. A real browser performs the steps and records what happened (pass, fail, screenshots).
4. The results are shown on a dashboard and in run history.

Everything is organised **like Azure DevOps**: you pick a **project** first, then a **version** (like a branch), and every
page works inside that project and version.

---

## 2. The big picture: three programs

```text
                      ┌───────────────────────────────────────────────┐
                      │  Browser  (the web app: React + TypeScript)   │
                      └───────────────────────┬───────────────────────┘
                                              │  HTTP + live events (SSE)
                                              ▼
 ┌────────────────────────────────────────────────────────────────────────────┐
 │  .NET API   (port 5080)  "the front door"                                  │
 │  • security checks   • projects, suites, versions, test cases              │
 │  • dashboard         • serves the web app files                            │
 │  • gateway: forwards everything it does not handle itself ───────────┐     │
 └───────────────┬───────────────────────────────────────────────────────┼─────┘
                 │ SQL                                                   │ HTTP
                 ▼                                                       ▼
        ┌─────────────────┐                      ┌──────────────────────────────────────┐
        │  SQL Server     │ ◄── batches of ───── │  Node.js Worker (port 4000)          │
        │  (the database) │     writes           │  • runs tests with Playwright        │
        └─────────────────┘                      │  • step library, custom steps        │
                                                 │  • Excel import and reports          │
                                                 │  • AI (Anthropic, Gemini)            │
                                                 │  • parameters, pages, Azure DevOps   │
                                                 └───────────────┬──────────────────────┘
                                                                 │ drives a real browser
                                                                 ▼
                                                      the application being tested
```

| Program     | Language             | Folder            | Its job                                                                           |
| ----------- | -------------------- | ----------------- | --------------------------------------------------------------------------------- |
| **Web app** | React, TypeScript    | `Frontend/`       | What people see and click. Talks only to the API.                                 |
| **API**     | C# (.NET 10)         | `Backend/src/`    | Owns the database and security. The only address the browser uses.                |
| **Worker**  | TypeScript (Node.js) | `Backend/Worker/` | Everything that needs Node tools: browser automation, Excel, AI, the step engine. |

Why two backends? Playwright, the Excel library and the step engine (built on the Zod library) are best in Node; storage,
security and structured business rules are best in .NET. [ADR 0010](adr/0010-moving-worker-features-to-dotnet.md) describes the
plan to move worker features into .NET one at a time.

**The browser never talks to the worker directly.** The API forwards requests it does not handle (a **reverse proxy**, built
with YARP in `Backend/src/API/Gateway/WorkerGateway.cs`). Any route the API implements itself wins over the forwarder, so
moving a feature from the worker to the API needs no change in the web app.

**How the programs are started.** An install starts with `qa-studio.cmd` (a small script that starts the API and the
worker). Developers can instead run the **Aspire AppHost** (`Backend/src/AppHost`): one command starts every program with hot
reload and opens a dashboard. Its most useful page is **Traces**, which shows one click followed through the API, the gateway
and the worker as a single timeline (**distributed tracing** with OpenTelemetry). See
[ADR 0012](adr/0012-aspire-for-development-and-observability.md).

---

## 3. One request, end to end

Two examples, because they show the two main shapes: "save data" and "run a test".

### 3.1 Creating a test case by hand

```text
 You press "Create and add steps"
   │
 ① React dialog (NewCaseDialog)  ──►  api.ts: send('/api/test-cases', {...})
   │                                             http.ts adds JSON headers, turns errors into ApiError
   ▼
 ② API security middleware        host check → origin check → token/session check
   ▼
 ③ Endpoint  (CreateTestCaseEndpoint)      "translate HTTP into a command"; contains no business logic
   │            dispatcher.SendAsync(new CreateTestCaseCommand(...))
   ▼
 ④ Dispatcher (our own mediator) runs the command through the pipeline:
        LoggingBehavior  →  ValidationBehavior (FluentValidation)  →  the handler
   ▼
 ⑤ CreateTestCaseHandler   loads the suite, checks the version belongs to the same project,
   │                        asks the domain to create the entity (DomainRules check every field)
   ▼
 ⑥ Repository + Unit of Work   EF Core writes the TestCase row and its step rows in ONE transaction
   ▼
 ⑦ SQL Server commits
   ▼
 ⑧ WorkerNotifier tells the worker "test cases changed" (a failed notice never fails the save)
   ▼
 ⑨ Endpoint returns 201 Created + the case as JSON
   ▼
 ⑩ Worker emits a live event over SSE (/api/events) ─► every open page refetches ─► the list updates
```

What to notice:

- Each layer does **one** job. The endpoint knows HTTP, the handler knows the use case, the domain knows the rules, the
  repository knows SQL.
- A mistake is caught at the earliest layer: bad JSON shape at ③/④, a rule like "title is required" in ⑤, a duplicate in ⑦.
  Every layer reports errors in the same JSON shape (section 7.2).

### 3.2 Running a test

```text
 You press Run (StartRunDialog)  ──►  POST /api/runs   (the API does not implement this, so the gateway forwards it)
   ▼
 Worker (Fastify route in app.ts)
   • reads each case's steps and parameters, checks the project is set up
   • RunManager queues one job per case (× per test account, for concurrent users)
   ▼
 PlaywrightExecutor opens a browser (signs in with the project's saved account/session)
   • runScenario: FIRST validates every step; if anything is unknown/invalid/missing a parameter,
     nothing runs and the case is "blocked". Otherwise runs the steps in order and records each result.
   ▼
 After every change the RunManager calls onChange:
   • storage.saveRun(run)  → queued in memory, flushed to the API in batches (write-behind)
   • events.emit({type:'run'}) → SSE → the Run History page refreshes itself
   ▼
 The API stores the run as a JSON document in SQL Server (table TestRuns)
```

---

## 4. The .NET API in detail

### 4.1 Four layers and one rule

```text
 Backend/src/
 ├── API/             ← the outside: HTTP endpoints, security, gateway, error handling      (knows HTTP)
 ├── Application/     ← the use cases: commands, queries, handlers, validators              (knows the app)
 ├── Core/            ← the heart: entities and business rules                               (knows nothing else)
 └── Infrastructure/  ← the tools: EF Core, Dapper, SQL, calling the worker                  (knows technology)
```

**The dependency rule:** arrows point inward only.
`API → Application → Core`, and `Infrastructure → Application → Core`.
Core never mentions EF Core, HTTP or JSON. This is **Clean (Onion) Architecture**; it keeps the rules testable without a
database and lets us swap a technology (for example, how we read data) without touching a rule.

How does Application use the database without knowing it? It declares an **interface** (for example `IDashboardReader`) in
`Application/Abstractions`, and Infrastructure provides the implementation. This is **Dependency Inversion**; the
framework's **Dependency Injection** container connects them at start-up (`AddApplication()`, `AddInfrastructure()`).

### 4.2 Start-up, in `Program.cs`

```text
 register services:  AddApplication → AddInfrastructure → AddApiCommon → AddApiSecurity → AddWorkerGateway
 build the pipeline: UseExceptionHandler → UseApiSecurity → UseFrontend → MapApiEndpoints → MapWorkerGateway → MapFrontendFallback
```

Order matters. A request meets, in order: the error handler, the security middleware, the static web app files, **our**
endpoints, then the worker forwarder, and finally the "send index.html" fallback (so a deep link like
`/project/SHOP/test-cases` opens the app).

### 4.3 CQRS: commands change things, queries only read

- A **command** (`ICommand<T>`, e.g. `CreateTestCaseCommand`) changes state.
- A **query** (`IQuery<T>`, e.g. `GetDashboardQuery`) only reads.
- Each has exactly one **handler** (`IRequestHandler<TRequest, TResult>`).

This is **CQRS** (Command Query Responsibility Segregation). The payoff: writes can use a rich domain model and
transactions, while reads can use fast hand-written SQL. Both live in `Application/Features/<Feature>/<UseCase>/`, one folder
per use case, so a feature is easy to find and delete (the **vertical slice** layout):

```text
 Application/Features/TestCases/CreateTestCase/
     CreateTestCaseCommand.cs     ← the input (a plain record)
     CreateTestCaseValidator.cs   ← FluentValidation rules for the input
     CreateTestCaseHandler.cs     ← the use case
```

### 4.4 The mediator and its pipeline

We wrote a small **Mediator** (`Application/Common/Dispatcher.cs`). Endpoints call `dispatcher.SendAsync(request)`. The
dispatcher finds the handler and wraps it in **pipeline behaviors**, a **chain of responsibility**: each behavior can do work
before and after the next one.

```text
 request ─► LoggingBehavior ─► ValidationBehavior ─► Handler ─► result
            (times it, logs)   (refuses bad input)
```

Adding a handler, validator or endpoint needs **no registration**: start-up scans the assemblies and registers everything it
finds (the **convention over configuration** idea).

### 4.5 Endpoints: REPR

An endpoint is a class implementing `IEndpoint` with one `Map` method (the **REPR** pattern: Request, Endpoint, Response).
It translates HTTP to a command/query and the result back to HTTP, and nothing else:

```csharp
routes.MapGet(ApiRoutes.Dashboard, async (int? projectId, int? versionId, IDispatcher dispatcher, CancellationToken ct) =>
    TypedResults.Ok(await dispatcher.SendAsync(new GetDashboardQuery(projectId, versionId), ct)));
```

Route strings are constants in `API/Common/ApiRoutes.cs`.

### 4.6 The domain: entities and rules

`Core/` holds entities such as `Project`, `TestSuite`, `ProjectVersion`, `TestCase`. Rules live **inside** the entity or in
small helper classes, not in handlers: `DomainRules` checks "required", "max length" and so on and throws a
`DomainValidationException` that names the broken field. This is **Domain-Driven Design (DDD)**: the model protects its own
invariants, so no code path can create an invalid case.

`Core/*Errors.cs` files create the specific exceptions (`NotFoundException`, conflicts) with stable error codes.

### 4.7 Storage: EF Core writes, Dapper reads

| Job                       | Tool                                                                                       | Why                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Writes and migrations     | **EF Core** (`Repositories/*Repository.cs`, `UnitOfWork`)                                  | Tracks changes, handles transactions, builds the schema. |
| Flat reads and aggregates | **Dapper** with hand-written SQL (`MasterDataReader`, `InsightsReader`, `DashboardReader`) | Faster and clearer for lists and counts.                 |

Patterns involved:

- **Repository**: hides how an entity is loaded and saved.
- **Unit of Work**: all changes in one use case are committed together or not at all.
- **Decorator**: `CachedMasterDataReader` wraps `MasterDataReader` and adds a cache; the cache is cleared after every change.
- **Optimistic concurrency**: every editable row has a `rowVersion`. If two people edit the same item, the second save is
  refused with HTTP 409 instead of silently overwriting. The web app sends back the `rowVersion` it opened.

Why both ORMs is explained in [ADR 0008](adr/0008-dapper-read-side.md).

### 4.8 The worker's state lives here too

The worker keeps data in memory for speed but the **database is the single source of truth**. It stores its data through the
API's internal routes (`/internal/persistence/*`, protected by a shared secret in `InternalTokenFilter`):

- At start-up the worker downloads a **snapshot** (cases, scenarios, runs, settings…).
- It writes changes back as **batches of operations** such as `run.upsert` or `config.upsert`. Each operation kind has its own
  handler class (`Strategies/RunOperations.cs`, `ConfigOperations.cs`): the **Strategy** pattern; adding a kind means adding a
  class.

Scenario, run and config documents are stored as JSON columns because the worker owns their shape.

### 4.9 Security at the edge

`ApiSecurityMiddleware` runs before any endpoint, and before forwarding to the worker:

1. **Host check**: stops DNS-rebinding tricks.
2. **Origin check** on changing requests (POST/PUT/DELETE): stops another website from driving the API through your browser.
3. **Access token / session cookie** (optional): `/api/health` and `/api/auth/*` stay open so you can sign in.

The worker trusts the API (it forwards with a token and strips the Origin and cookie headers).

### 4.10 Errors always look the same

`ApiExceptionHandler` turns exceptions into one JSON shape: `{ "error": { "code": "...", "message": "...", "fields": { ... } } }`.
`code` is stable for programs, `message` is safe for people, `fields` names the input to highlight. The web app's
`ApiError` class reads exactly this.

### 4.11 Recipe: add a read-only feature (the dashboard is the worked example)

1. `Application/Abstractions/Persistence/IDashboardReader.cs`: the interface and its plain data records.
2. `Application/Features/Dashboard/GetDashboard/`: `GetDashboardQuery`, `GetDashboardHandler`, and `DashboardBuilder`
   (**pure** logic: input in, result out, trivial to unit test).
3. `Infrastructure/Persistence/Repositories/DashboardReader.cs`: Dapper SQL; registered in `Infrastructure/DependencyInjection.cs`.
4. `API/Endpoints/Dashboard/GetDashboard/GetDashboardEndpoint.cs` and a constant in `ApiRoutes.cs`.
5. Tests: unit tests for the builder (`DashboardBuilderTests`), an integration test against a real SQL Server
   (`DashboardTests`).

A **write** feature adds a command, validator, entity rules and a repository call, then commits through the unit of work and
notifies the worker.

---

## 5. The Node worker in detail

### 5.1 Map

```text
 Backend/Worker/
 ├── services/
 │    ├── qa-api/     the worker's HTTP server (Fastify) and its services (the "application")
 │    └── qa-mcp/     an MCP server so AI assistants can use QA Studio as tools
 └── packages/        reusable libraries, each with one job
      ├── shared/            schemas (Zod): test cases, runs, config; the single definition of data shapes
      ├── automation-core/   the step engine: action registry, generic steps, scenario runner
      ├── execution-engine/  RunManager (queue, concurrency) and PlaywrightExecutor (the browser)
      ├── test-case-import/  Excel reading and column detection
      ├── agents/            AI prompts: propose cases, write steps, explain failures
      ├── llm/               model providers (Anthropic, Gemini) behind one interface
      ├── knowledge/         local search index the AI uses for context
      └── reporting/         HTML and Excel reports
```

Packages depend downward only (`services → packages`), and `shared` depends on nothing, the same dependency idea as the .NET
side.

### 5.2 The app: `createApp(store, automation)`

`services/qa-api/src/app.ts` builds the Fastify server. Everything it needs is passed in as one `automation` object of
**providers** (parameters, settings, accounts, custom steps, AI…). That is **dependency injection by hand**: the real wiring is
in `server.ts`; tests pass small fakes. This is why the worker is easy to test without a browser or database.

Each feature is a **service class** with a narrow dependency interface (for example `ParameterService` takes a store that only
has `loadConfig` and `saveConfig`). Routes are thin: parse input with a schema, call the service, return the result.

### 5.3 Steps are data, not code

A test case's runnable form (a **scenario**) is a list of steps:

```json
{
  "action": "click",
  "params": { "target": { "role": "button", "name": "Delete" } }
}
```

- The **action registry** (`ActionRegistry`) maps an action name to a definition: its **Zod schema** (what parameters are
  valid), a `run` function, and `ui` metadata (label, group, fields). This is the **Registry** / plugin pattern.
- The same schema serves three purposes: it **validates** a step, it generates **JSON Schema** for review, and it describes
  the **form** the step editor shows. One definition, no drift. This is the main reason the engine is in Node.
- `runScenario` is an **interpreter**: it first validates every step (unknown action, bad parameter, missing `{{data.x}}`
  value, destructive step not allowed) and runs nothing if any check fails; otherwise it runs the steps in order.
- Strings can contain `{{data.name}}` (the case's parameter, filled before the run) and `{{var.name}}` (a value remembered by an
  earlier step).

**Custom steps** (`custom-steps.ts`) let a project define its own steps from the standard ones: inputs plus a body of steps
using `{{input.name}}`. Each is registered as an action `custom.<projectId>.<key>`, so validation, reports and the editor treat
it like any other. It is the **Composite** pattern: one action made of other actions.

### 5.4 Running tests

- `RunManager` keeps a queue, limits concurrency (workers), supports cancel, and calls `onChange` after every change.
- `PlaywrightExecutor` opens a browser context per job, signs in using the project's setup (login form, saved session, or none),
  runs the scenario, and saves screenshots and traces as **artifacts**.
- After a restart, runs that were queued or running are closed as cancelled, so history never lies.

### 5.5 Memory plus write-behind storage

The worker holds everything in an in-memory `MemoryStore` for fast reads. `RemoteStorage` extends it:

- **Hydrate** at start from the API snapshot.
- **Write-behind:** every `save…` call queues an operation and schedules a flush (about 100 ms). Operations are sent to the API in
  batches, in order, with retry. A request that changed something is **not answered until its writes have committed** (a Fastify
  `onSend` hook), so "saved" always means "in the database".

The trade-off: the worker's copy can be stale if someone else changes the data. The API therefore pushes **sync notices**
(`/internal/sync/test-cases`) and the worker also reloads cases before each run.

### 5.5b Data the API owns, that the worker only reads

Some data moved to the API in stages ([ADR 0010](adr/0010-moving-worker-features-to-dotnet.md)): the dashboard, run history reads,
the page list and parameter values. For a block the worker _also_ uses while running tests (the page list), two things keep its in-memory copy from
going stale: the API sends a **change notice** after every save (`/internal/sync/config`), and the worker **re-reads the block from
the database before each run**. Remember this pair when you move the next feature. Parameter values use a simpler variant: the
worker keeps no copy at all and asks the API for a run's values when the run starts, refusing the run if it cannot get them.

### 5.6 Live events

`events.ts` is a tiny **publish/subscribe** bus. The worker's `GET /api/events` streams them as **Server-Sent Events**. The
events carry _what changed_, never the data (for example `{type:"run", id, status}`); the browser refetches through the normal
API. Simple and hard to get out of sync.

### 5.7 AI

`llm/` hides providers behind one interface (the **Adapter** / **Strategy** pattern): Anthropic, Gemini, and a `FakeLlm` for
tests. `agents/` holds the prompts and parsing. AI is always optional and its output is always shown for review before it runs;
see [AI-AND-MCP.md](AI-AND-MCP.md).

### 5.8 "Capabilities": spotting an old worker

The worker lists what it offers (`WORKER_CAPABILITIES`) in `GET /api/automation`. The web app compares that with what it needs
and shows **one** banner ("The worker is out of date: restart it") instead of failing one request at a time. Unknown routes
answer `route-not-found` for the same reason. Add a name whenever a release adds routes the web app depends on.

---

## 6. The web app in detail

### 6.1 Stack and map

React 18, TypeScript, Vite, CSS Modules, Recharts (charts), Vitest + Testing Library + axe (tests).

```text
 Frontend/src/
 ├── main.tsx             starts React
 ├── app/                 App.tsx: providers, access gate, shell (menu, header, project switchers), page selection
 ├── design-system/       reusable UI that never calls the API
 │     ├── tokens/        colours, spacing, fonts as CSS variables
 │     ├── atoms/         Button, Icon, Inputs, Badge, Spinner
 │     ├── molecules/     Field, Menu, Tabs, Alert, StatusBadge
 │     ├── organisms/     Dialog, DataTable, Panel, StickyBar, Toaster
 │     └── templates/     AppLayout (sidebar, header, bottom bar), SettingsLayout
 ├── features/            one folder per business area (page + components + api.ts)
 │     dashboard · test-case-studio · test-cases · test-execution · runs · ai-assistant
 │     azure-devops · master-data (projects, versions, suites, custom steps) · sign-in-users · settings · import
 └── shared/              api/ (http, live events, catalog), hooks/ (useAsync, useRoute, useWorkContext), lib/
```

Two rules keep it tidy ([ADR 0003](adr/0003-atomic-design-feature-folders.md)):

1. The **design system** knows nothing about the business. It never imports from `features/` or calls the API.
2. A **feature** owns its screens, its components and its own `api.ts` (the only place that builds that feature's requests).

This is **Atomic Design** for the UI and **feature-sliced** folders for the code: the same "small, focused, replaceable
pieces" idea as the backend.

### 6.2 Project-first navigation

```text
 /                                  Projects: choose (or create) a project
 /settings/<section>                Organization settings
 /project/<CODE>/dashboard          ┐
 /project/<CODE>/test-cases         │  everything below runs inside that project
 /project/<CODE>/ai-assistant       │  and the version chosen in the header
 /project/<CODE>/test-execution     │
 /project/<CODE>/run-history        │
 /project/<CODE>/azure-devops       │
 /project/<CODE>/settings/<section> ┘  application & sign-in, versions, suites, parameters, custom steps, users
```

- `shared/hooks/useRoute.ts` is a tiny **router** on the History API (clean paths, no `#`). Links are plain `<a href>`; a global
  click handler turns same-app clicks into in-page navigation, so new tabs, the back button and screen readers all work. It is
  the one place that maps page names to addresses.
- `features/master-data/ProjectScope.tsx` is a **React Context provider**. It reads the project from the address and the
  version from the header switcher (remembered in the browser), and every page calls `useProjectScope()`. No page has its own
  project picker, so the scope can never disagree between pages.
- `app/App.tsx` chooses the menu (organization level vs project level), redirects old addresses, shows the "worker out of date"
  banner, and renders the page. Pages are **lazy loaded**: the code for a screen downloads on first visit only.

### 6.3 Data flow: no global store

There is no Redux. Each screen loads what it needs and keeps it locally:

```text
 Screen ─► useResource(() => fetchSomething())      loading / error / data, ignores stale answers, reload()
        ─► useLive(event => reload())               server says "something changed" ─► refetch
 Save   ─► api.ts function ─► http.ts send()        failures become ApiError(code, message, fields)
        ─► toast on success, field errors beside the input on failure
```

- `shared/api/http.ts`: `get` / `send` with one error class.
- `shared/api/live.ts`: **one** shared EventSource connection for the whole page; screens subscribe with `useLive`.
- `shared/api/catalog.ts`: the step actions and pages for the editor, cached per project.
- `useWorkContext`: the chosen version and last project, in `localStorage`.

Server state stays on the server; the UI always refetches instead of patching its own copy, which is why live updates are simple.

### 6.4 The step editor, as a worked example of the design

Each step is a card built from the **catalog** the worker sends (`ActionInfo` with `ui.fields`). The component does not know any
action by name; it draws whatever fields the action declares (text, number, choice, page, element, yes/no). A new standard or
custom step appears in the editor with **no frontend change**. Element fields use `TargetField` ("Button named Delete, inside the
dialog"), so nobody writes CSS selectors.

### 6.5 Styling and responsiveness

- **Design tokens** (`design-system/tokens/tokens.css`) define every colour, space and font size once. Components use only tokens.
- Each component has its own **CSS Module** (`Foo.module.css`), so class names never clash.
- The shell adapts: desktop sidebar, tablet icon rail, phone drawer plus bottom bar. Popups become full-screen sheets on phones.
  Tables turn into labelled rows on narrow screens. Test at 375 px.

### 6.6 Accessibility

Real `<button>` and `<a>` elements, labelled inputs, focus trapped in dialogs, keyboard shortcuts (Escape, Ctrl+S), live regions
for status text, and automated axe checks in tests. Colour is never the only signal (icons and words go with it).

---

## 7. Cross-cutting topics

### 7.1 Where is each kind of data?

| Data                                                                           | Owner                    | Stored as                                         |
| ------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------- |
| Projects, suites, versions                                                     | API                      | Tables (EF Core)                                  |
| Test cases and their written steps                                             | API                      | Tables                                            |
| Scenarios (runnable steps), runs, settings, parameters, custom steps, accounts | Worker (through the API) | JSON documents / config blocks in SQL Server      |
| Passwords and AI keys                                                          | Worker                   | Encrypted at rest; never sent back to the browser |
| Screenshots and traces                                                         | Worker                   | Files on disk, listed in the run                  |

### 7.2 Error handling, one shape everywhere

`{ error: { code, message, fields? } }` from both servers. The web app shows `message`, puts `fields` next to inputs, and keeps
what the person typed.

### 7.3 Concurrency and safety

- Row versions and HTTP 409 stop "last save wins" overwrites (cases, projects, scenarios).
- Steps that delete data run only where deleting is explicitly allowed.
- A step is validated before **any** step runs, so a half-run case cannot happen because of a typo.
- Removing something that is still used (a project with suites, a custom step used by cases) is refused with an explanation.

### 7.4 Testing: a pyramid

| Level       | What                                                                      | Where                                                                                 |
| ----------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Unit        | Pure rules, no I/O                                                        | `Backend/tests/QaStudio.UnitTests` (e.g. `DashboardBuilderTests`), worker `*.test.ts` |
| Integration | Real API + real SQL Server (a throw-away database per run)                | `Backend/tests/QaStudio.IntegrationTests`                                             |
| Worker app  | Fastify `inject()` with fakes; Playwright against a stub app              | `services/qa-api/src/*.test.ts`, `*.browser.test.ts`                                  |
| UI          | Whole app rendered in jsdom against a fake server, plus axe accessibility | `Frontend/src/app/*.test.tsx`, `src/test/fake-server.ts`                              |

Rule of thumb: put a rule in a **pure function** and test it with plain inputs; test the wiring only once.

### 7.5 Quality gates

C#: warnings as errors, SonarAnalyzer rules (complexity, naming), nullable on. TypeScript: strict mode, ESLint, Prettier.
Every public thing has a doc comment. Run the checks before you commit (commands are in `Backend/README.md` and
`Frontend/README.md`).

---

## 8. Running and changing it

```text
 Start everything       npm start  (in Backend/Worker)      starts the API and the worker together
 API from Visual Studio run the QaStudio.Api project          then start only the worker: npm run worker
 Frontend dev server    npm run dev  (in Frontend)           proxies /api to the API on 5080
```

Common surprises:

- **"The worker is out of date" / "Not found" on a new page.** The Node worker keeps running its old code after an update.
  Stop it and run `npm run worker` (it rebuilds first).
- **`ECONNREFUSED 127.0.0.1:5080` in the dev server.** The API is not running yet (or is rebuilding). Start it; the dev server
  answers with a clear 503 meanwhile.
- **A change to a database table** needs an EF Core migration (`Backend/src/Infrastructure/Persistence/Migrations`).

Checklist for a typical change:

1. Which layer owns this? (UI → feature; rule → Core; use case → Application; SQL → Infrastructure; browser/step → worker)
2. Write or extend the **pure** part first, with a unit test.
3. Wire it (endpoint or route, then the `api.ts` function, then the screen).
4. Update the matching document and the changelog in the same commit.

---

## 9. All the patterns in one table

| Pattern / idea                     | Where you see it                                                                                                 | Why it is used                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Clean / Onion architecture         | `Core ← Application ← API`, `Infrastructure → Application`                                                       | Rules independent of technology; easy tests           |
| Dependency inversion + injection   | Interfaces in `Application/Abstractions`, implementations in `Infrastructure`; `automation` object in the worker | Swap or fake any dependency                           |
| DDD (entities, invariants)         | `Core/*`, `DomainRules`                                                                                          | Invalid data can never be created                     |
| CQRS                               | `ICommand` / `IQuery` per use case                                                                               | Rich writes, fast reads                               |
| Vertical slice                     | `Features/<Feature>/<UseCase>/`                                                                                  | A feature is easy to find, change, delete             |
| Mediator                           | `Dispatcher`                                                                                                     | Endpoints do not know handlers                        |
| Chain of responsibility (pipeline) | `LoggingBehavior`, `ValidationBehavior`                                                                          | Cross-cutting work in one place                       |
| REPR endpoints                     | `IEndpoint` classes, assembly scan                                                                               | Thin HTTP layer, no manual registration               |
| Repository + Unit of Work          | `Repositories/*`, `UnitOfWork`                                                                                   | Hide persistence; atomic commits                      |
| Decorator                          | `CachedMasterDataReader`                                                                                         | Add caching without changing the reader               |
| Strategy                           | Worker-operation handlers; LLM providers                                                                         | Add a variant by adding a class                       |
| Optimistic concurrency             | `rowVersion`, HTTP 409                                                                                           | No silent overwrites                                  |
| Reverse proxy / gateway            | YARP `WorkerGateway`                                                                                             | One address for the browser                           |
| Middleware                         | `ApiSecurityMiddleware`                                                                                          | Security checks before any endpoint                   |
| Options pattern                    | `LimitsOptions`, `SecurityOptions`, `WorkerOptions`                                                              | Typed, validated settings                             |
| Write-behind cache                 | `RemoteStorage` over `MemoryStore`                                                                               | Fast reads, durable writes                            |
| Registry / plugin                  | `ActionRegistry`                                                                                                 | Add steps without touching the runner                 |
| Interpreter                        | `runScenario` over data steps                                                                                    | Test cases are data, not code                         |
| Composite                          | Custom steps                                                                                                     | A step made of steps                                  |
| Schema as single source of truth   | Zod in worker + `shared`                                                                                         | Validate, document and draw forms from one definition |
| Publish / subscribe + SSE          | `events.ts`, `live.ts`                                                                                           | Live pages without polling                            |
| Strangler (gradual migration)      | [ADR 0010](adr/0010-moving-worker-features-to-dotnet.md)                                                         | Move features without a big-bang rewrite              |
| Atomic design                      | `design-system/atoms → templates`                                                                                | Reusable, consistent UI                               |
| Feature folders                    | `Frontend/src/features/*`                                                                                        | Each area owns its code                               |
| Context provider                   | `ProjectScopeProvider`                                                                                           | One shared project/version everywhere                 |
| Custom hooks                       | `useResource`, `useLive`, `useRoute`                                                                             | Reuse stateful logic                                  |
| Lazy loading                       | `lazy(() => import(...))` in `App.tsx`                                                                           | Fast first load                                       |

---

## 10. Where to start reading

Follow one slice from top to bottom, in this order:

1. `Frontend/src/features/test-case-studio/TestCaseStudioPage.tsx`: the screen; then `features/test-cases/api.ts`.
2. `Backend/src/API/Endpoints/TestCases/CreateTestCase/`: the endpoint.
3. `Backend/src/Application/Features/TestCases/CreateTestCase/`: command, validator, handler.
4. `Backend/src/Core/TestCases/TestCase.cs`: the entity and its rules.
5. `Backend/src/Infrastructure/Persistence/Repositories/TestCaseRepository.cs`: saving.
6. Then the dashboard slice (smaller, read-only): `Application/Features/Dashboard/` and `DashboardReader.cs`.
7. Worker: `packages/automation-core/src/registry.ts`, `generic/actions.ts`, `scenario.ts`, then `services/qa-api/src/app.ts`.

**Exercises** (each touches every layer you just read):

- Add a "description" length rule to test cases and see where the error appears in the UI.
- Add a new standard step (for example "double-click") and watch it appear in the editor with no frontend change.
- Add a field to the dashboard response and show it on the page (write the unit test first).

---

## Related documents

[GETTING-STARTED.md](GETTING-STARTED.md) · [BACKEND.md](BACKEND.md) · [FRONTEND.md](FRONTEND.md) · [DATABASE.md](DATABASE.md) ·
[STEP-FORMAT.md](STEP-FORMAT.md) · [TEST-CASES-AND-IMPORTS.md](TEST-CASES-AND-IMPORTS.md) · [AI-AND-MCP.md](AI-AND-MCP.md) · [adr/](adr/)
