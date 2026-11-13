# 0012 — Aspire for development and observability, not for installs

**Status:** accepted as a spike (2026-11-13). Builds on [0005](0005-sql-server-and-dotnet-api.md) and
[0010](0010-moving-worker-features-to-dotnet.md); changes nothing in either.

## Context

QA Studio is four processes in two runtimes: the .NET API (the only address the browser uses), the Node worker, the optional
voice agent, and in development the Vite dev server. What held them together was hand-written:

- `Worker/scripts/start.mjs` starts the API and worker, copies the shared secret into each one's variable name
  (`QA_INTERNAL_TOKEN` → `Worker__InternalToken`), stops both together and polls `/api/health`.
- Developers started up to four terminals for hot reload (Visual Studio or `dotnet run`, `npm run worker`, `npm run voice`,
  `npm run dev`) and kept the ports and the token equal by hand.
- **Nothing showed one request across the processes.** A click goes browser → API → YARP gateway → worker → write-behind
  batch → API → SQL Server, and a slow or failed step had to be found by reading two consoles.

## Decision

Add [Aspire](https://aspire.dev) as a **development orchestrator and telemetry dashboard**, in two projects and one Node module:

| Piece                                | What it does                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Backend/src/AppHost`                | Declares the API, `worker-build` (one `tsc -b`), the worker, the optional voice agent, the Vite dev server and an optional SQL Server container, and what waits for what. Generates the internal token once (user secrets) and gives it to both sides. Runs everything with **hot reload** and opens the dashboard: logs, traces, metrics, health. |
| `Backend/src/ServiceDefaults`        | OpenTelemetry for the API (ASP.NET Core, HttpClient, which also covers the YARP forwarder, runtime metrics, logs). **Switched on only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set**, which the AppHost does; an install has no endpoint, so it registers nothing.                                                                                       |
| `Worker/services/qa-api/src/telemetry.ts` | The same for the worker: a server span per Fastify request (continuing the caller's `traceparent`) and client spans for outgoing `fetch` (undici), exported over OTLP. Off, and nothing loaded, without the endpoint.                                                                                                                              |

Hot reload per process:

| Process  | How                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API      | From the command line, `dotnet watch` (edits applied in place; restarts on edits it cannot apply). Launched from Visual Studio or VS Code, the IDE runs the project with its own debugger and hot reload. |
| Worker   | `tsc -b --watch` recompiles the changed packages; `node --watch` restarts the worker when its output changes.                                                                                             |
| Voice    | Same as the worker (only when `QaStudio:Voice` is true).                                                                                                                                                    |
| Frontend | Vite's hot module replacement, unchanged.                                                                                                                                                                    |

Rules that keep this safe:

1. **Installs do not change.** `qa-studio.cmd` and `start.mjs` stay the way QA Studio starts on a tester's machine. The AppHost,
   its dashboard and orchestrator are developer tools and are not shipped.
2. **The domain does not know.** Only `QaStudio.Api` references ServiceDefaults; Core, Application and Infrastructure are
   untouched, as is the Clean Architecture dependency rule.
3. **No Docker by default.** The API keeps using the connection string in `Backend/appsettings.json`. A scratch database
   (`ConnectionStrings:QaStudio` given to the AppHost) or a SQL Server container (`QaStudio:SqlContainer`) are opt-in.
4. **Same addresses as today.** Ports are fixed (5080, 4000, 5173 by default, configurable) and bound to `127.0.0.1`, so the
   API's host and origin checks, the worker's loopback rule and the Vite proxy work unchanged.
5. **No `npm install` on start.** It could rewrite a lockfile; dependencies are still installed with `npm ci`.

## Rejected

- **Aspire's standard HTTP resilience handler on every `HttpClient`.** Retrying the API's non-idempotent calls to the worker
  (start a run) could start a run twice. Resilience is added per client when a call is known to be safe to repeat.
- **Service discovery.** The AppHost passes the worker's address as the existing setting `Worker:BaseUrl`, which works with
  and without Aspire.
- **Making the AppHost the product's launcher.** It needs the .NET SDK, starts an orchestrator and a dashboard, and assigns
  its own ports to them; a tester's machine needs none of that.
- **Node http auto-instrumentation.** In an ES module app it needs a loader hook on the `node` command line; one server span
  per Fastify request and undici's diagnostics channel give the same trace without it.

## Consequences

- One command (`dotnet run --project Backend/src/AppHost`, or F5 on the AppHost) starts everything with hot reload, and the
  dashboard shows one trace from the API through the gateway to the worker and back. Checked by hand on the spike: a request
  through Vite → API → YARP → worker is one trace; editing a route in the API and in the worker went live in about 7 seconds.
- A worker restart under `node --watch` closes queued and running test runs as cancelled, as after any restart.
- `dotnet watch` builds into `src/API/bin/Debug`, which Visual Studio locks while it runs the API: use one or the other.
- New packages: Aspire hosting 13.6.5 (AppHost only), OpenTelemetry .NET 1.21.0 (API), OpenTelemetry JS 3.1 / 0.301
  (worker). `npm audit` finds nothing new.
- **Not done yet (next steps):** run the integration tests in CI against `QaStudio:SqlContainer` with `Aspire.Hosting.Testing`;
  EF Core / SqlClient spans; spans around `RunManager` jobs and the write-behind flush; deployment output, only if QA Studio is
  ever hosted as a server.
