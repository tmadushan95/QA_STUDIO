# QA Studio backend

.NET 10 API over SQL Server. It is the only address the browser uses: it serves test cases, projects, versions, suites and dashboard insights itself, and forwards
everything else to the Node worker (`Worker/services/qa-api`). End to end, with the architecture and patterns: [docs/BACKEND.md](../docs/BACKEND.md).

```
src/Core            The domain: entities, rules, errors. Depends on nothing.
src/Application     Features/<Feature>/<UseCase>: command or query, handler, response. Interfaces for what they need.
src/Infrastructure  EF Core (writes, migrations), Dapper (master data and insights reads), repositories, cache, worker client.
src/API             Endpoints/<Feature>/<UseCase>: endpoint, request. Security, error shape, gateway to the worker, Swagger.
src/ServiceDefaults OpenTelemetry for the API; on only when OTEL_EXPORTER_OTLP_ENDPOINT is set (the AppHost sets it).
src/AppHost         Aspire, for development: runs API, worker, voice and Vite with hot reload, plus the dashboard.
tests/              Unit tests, and integration tests against real SQL Server.
Worker/             The Node worker: its services, libraries, .env, encryption key and run evidence.
appsettings.json    All API settings. Never hard-coded.
azure-pipelines.yml CI. Point the Azure DevOps pipeline at this path.
qa-studio(.cmd)     Builds and starts everything, then opens the browser.
```

To add a use case, see [docs/BACKEND.md](../docs/BACKEND.md#add-a-use-case). A route implemented here wins over the gateway's catch-all.

## Setup

Requires the .NET 10 SDK, the EF Core tools (`dotnet tool install -g dotnet-ef`) and SQL Server.

1. Set the connection string in `appsettings.json`, or with the environment variable `ConnectionStrings__QaStudio`.

2. Create `appsettings.Development.json` beside it. It is git-ignored, because it holds the secret shared with the worker:

   ```json
   {
     "Database": { "ApplyMigrationsOnStartup": true },
     "Worker": { "InternalToken": "<32+ random characters, the same as QA_INTERNAL_TOKEN in Worker/.env>" }
   }
   ```

## Database migrations

Run from this folder.

```bash
dotnet ef database update --project src/Infrastructure --startup-project src/Infrastructure
```

To add a migration after changing the model:

```bash
dotnet ef migrations add <Name> --project src/Infrastructure --startup-project src/Infrastructure --output-dir Persistence/Migrations
```

In Development, pending migrations are also applied when the API starts.

## Run

```bash
dotnet run --project src/API
```

Listens on http://127.0.0.1:5080, with Swagger at `/swagger` in Development. Test case and master data routes work on their own; routes
that need the worker answer 503 `worker-unavailable` until it is running. `npm start` in `Worker`, or `qa-studio.cmd` here, runs everything.

### Run everything for development (Aspire)

```bash
dotnet run --project src/AppHost
```

Or F5 on **QaStudio.AppHost** in Visual Studio. It starts:

| Resource       | What runs                                                         | Hot reload                                                   |
| -------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| `api`          | The API on `QaStudio:ApiPort` (5080)                              | `dotnet watch` (in an IDE, the IDE's own hot reload)         |
| `worker-build` | `tsc -b` once; the worker and voice agent wait for it             |                                                              |
| `worker-watch` | `tsc -b --watch`                                                  | Recompiles changed packages                                  |
| `worker`       | `node --watch services/qa-api/dist/server.js` on `WorkerPort` (4000) | Restarts on new output (cancels runs in progress)          |
| `voice`        | The voice agent, only when `QaStudio:Voice` is `true`             | As the worker                                                |
| `frontend`     | `npm run dev` (Vite) on `FrontendPort` (5173)                     | Vite HMR                                                     |
| `sql`          | A SQL Server container, only when `QaStudio:SqlContainer` is `true` (needs Docker; migrated on start) |               |

The dashboard (http://localhost:15080) shows state, console logs, health and **traces across the API and the worker**. The
internal token is generated once, kept in the AppHost's user secrets and given to both sides, so `Worker:InternalToken` and
`QA_INTERNAL_TOKEN` cannot disagree. Ports stay fixed and on `127.0.0.1`, so the security checks work unchanged.

AppHost settings, in `src/AppHost/appsettings.json` or as `QaStudio__<Name>` environment variables:

| Key                                              | Default            | Meaning                                                         |
| ------------------------------------------------ | ------------------ | --------------------------------------------------------------- |
| `QaStudio:ApiPort`, `WorkerPort`, `FrontendPort` | 5080, 4000, 5173   | Ports, e.g. to run beside an API started from Visual Studio     |
| `QaStudio:HotReload`                             | `true`             | `false` runs the built API and worker without watchers          |
| `QaStudio:Frontend`                              | `true`             | Start the Vite dev server                                       |
| `QaStudio:Voice`                                 | `false`            | Start the voice agent                                           |
| `QaStudio:SqlContainer`                          | `false`            | Use a throw-away SQL Server container                           |
| `ConnectionStrings:QaStudio`                     | (not set)          | When set for the AppHost, given to the API (a scratch database) |

Notes: run `npm ci` in `Worker` and `../Frontend` first (the AppHost never installs packages). Stop the API in Visual Studio
before using `dotnet watch`, which builds into the `bin/Debug` folder VS locks. Installs still start with `qa-studio.cmd`; the
AppHost is a developer tool ([ADR 0012](../docs/adr/0012-aspire-for-development-and-observability.md)).

## Tests

```bash
dotnet test
```

The build fails on any warning, including SonarQube's rules (`SonarAnalyzer.CSharp` runs in every build).

Integration tests create a database named `QaStudio_Test_<guid>` on the configured server and drop it afterwards. They refuse to start
if the API is connected to anything else, so they cannot touch real data. To use another server, set `QASTUDIO_TEST_CONNECTION`.

## Settings

| Key                                 | Meaning                                                       |
| ----------------------------------- | ------------------------------------------------------------- |
| `ConnectionStrings:QaStudio`        | SQL Server. Pool sizes are set here.                          |
| `Urls`                              | Where the API listens                                         |
| `Database:CommandTimeoutSeconds`    | Seconds before a command is abandoned                         |
| `Database:MaxRetryCount`            | Retries of transient SQL failures                             |
| `Database:ApplyMigrationsOnStartup` | Apply pending migrations at start                             |
| `Database:MasterDataCacheMinutes`   | Longest master data may be served from memory                 |
| `Limits:MaxPageSize`                | Most test cases on one page                                   |
| `Limits:MaxStepsPerCase`, `MaxStepLength` | How much a form may send for one test case              |
| `Limits:MaxCasesPerRequest`         | Most test cases one delete or move may name                   |
| `Limits:MaxWorkerBatch`             | Most worker writes in one transaction                         |
| `Limits:SnapshotRuns`               | Newest runs the worker loads when it starts                   |
| `Limits:MaxAuditEntries`            | Most audit entries one request may read                       |
| `Worker:BaseUrl`                    | The worker                                                    |
| `Worker:InternalToken`              | **Required, secret.** Shared with the worker. Internal routes stay closed without it. |
| `Security:AdminToken`               | Optional access token for every `/api` route. Must equal the worker's `QA_ADMIN_TOKEN`. |
| `Security:AllowedHosts`, `AllowedOrigins` | Extra hosts and origins, beyond loopback                |
| `Frontend:DistPath`                 | The built frontend, relative to the API project               |
| `OTEL_EXPORTER_OTLP_ENDPOINT`       | Optional. Sends traces, metrics and logs over OTLP (the AppHost sets it). Unset: telemetry is off. |

Environment variables override the files, using `__` for `:`, such as `Worker__InternalToken`. Keep secrets out of `appsettings.json`.

## API

Swagger has the details. Errors always look like `{ "error": { "code", "message", "fields" } }`.

```
GET/POST           /api/projects              GET/PUT/DELETE /api/projects/{id}
GET/POST           /api/test-suites           GET/PUT/DELETE /api/test-suites/{id}
GET/POST           /api/test-cases            GET/PUT        /api/test-cases/{caseId}
GET                /api/test-cases/next-id    POST           /api/test-cases/delete, /api/test-cases/move
GET                /api/audit, /api/health    POST           /api/auth/login, /api/auth/logout
GET                /api/auth/status           *              /api/**  forwarded to the worker
```
