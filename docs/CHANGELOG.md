# Changelog

## Unreleased

### Aspire for development, with hot reload and tracing — 2026-11-13

- **One command for developers:** `dotnet run --project Backend/src/AppHost` (or F5 on **QaStudio.AppHost**) starts the API, the
  worker, the Vite dev server and, optionally, the voice agent and a SQL Server container. The Aspire dashboard
  (http://localhost:15080) shows each one's state, console logs and health
  ([adr/0012](adr/0012-aspire-for-development-and-observability.md)).
- **Hot reload everywhere:** `dotnet watch` for the API (an IDE uses its own), `tsc --watch` + `node --watch` for the worker and
  voice agent, Vite HMR for the web app. The voice agent stops `node --watch`'s file reporting from reaching the job
  processes LiveKit forks, which otherwise closed it at start ("The voice assistant did not join").
- **Normal certificate trust for the Node processes under the AppHost.** Aspire's default points `SSL_CERT_DIR` at its
  development certificate only; LiveKit's native client then trusted no public CA, so the voice agent registered but could
  not join the room. The worker, voice agent and Vite now keep the machine's trust (`CertificateTrustScope.None`).
- **Distributed tracing:** OpenTelemetry in the API (`Backend/src/ServiceDefaults`) and the worker
  (`services/qa-api/src/telemetry.ts`) joins one request into one trace across the API, the gateway and the worker. It is on only
  when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, so installs are unchanged.
- **Installs are unchanged:** `qa-studio.cmd` and `npm start` start QA Studio as before. The Vite dev server now also reads
  `PORT` (default 5173).

### Project-first navigation — 2026-11-09

- **Choose a project first, like Azure DevOps.** The start page lists projects; nothing else is offered until one is open. Inside a
  project the menu is Dashboard · Test Case Studio · AI Assistant · Test Execution · Run History · Azure DevOps, with **Project
  settings** at the foot (Application & sign-in, Versions, Test suites, Parameters, Sign-in users).
- **Header switchers:** `Projects / [project ▾] / [version ▾]`. The project switcher opens the same page in another project; the
  version switcher works like a branch picker and applies to every page until changed.
- **One scope everywhere:** Test Case Studio, Test Execution, Run History, the Dashboard, the AI Assistant and Azure DevOps all use the
  header's project and version; per-page project pickers are gone. The server filters dashboard, runs and insights by
  `?projectId=&versionId=`.
- **Addresses:** `/project/<CODE>/<page>` and `/settings/<section>` (Organization settings). Old addresses open the page that replaced
  them.
- **Test Case Studio** replaces Test Design: one "Create test cases" entry (Excel, AI, by hand, Azure DevOps) that always asks for the
  version, status chips instead of cards and tabs, a sticky toolbar that becomes the bulk bar, and Delete and History per case.
- **AI Assistant redesigned:** prompt first, proposals as a card grid, saved cases show how step writing went; the AI automates what
  it can and lists the rest as "Check by hand" instead of refusing whole cases.
- **Parameters in two layers:** per case, or common to the project (Project settings › Parameters).
- **Clean URLs** without `#`; the dev server proxy keeps the browser's host, so uploads through `localhost:5173` are no longer refused.
- **Out-of-date worker** is named once in a banner, instead of "Not found" errors. Restart QA Studio after updating.
- **Test case popup redesigned:** ID chip and title, where the case is filed, a "Ready to run?" check (steps, parameters,
  approval) that opens the tab that fixes each item, the case's facts in a side rail, and a footer that says the next thing
  to do. On phones it is a full-screen sheet with the checks as chips and full-width Save buttons.
- **Dashboard now served by the .NET API** (stage 1 of moving worker features, [adr/0010](adr/0010-moving-worker-features-to-dotnet.md)):
  `GET /api/dashboard` is computed from the database by the API, with the same JSON and the same rules (ported tests carried
  over). The worker no longer serves it. Restart the worker after updating so it drops the old route.
- **Parameter values now owned by the .NET API** (stage 3c, [adr/0011](adr/0011-parameter-values-in-tables.md)): the values moved from
  two JSON blocks into tables (`CaseParameterValues`, `ProjectParameterValues`) with a migration that copies them and leaves the old
  blocks in place. Saving, suggesting and auto-filling are served by the API with the same routes and JSON; the AI is still asked
  through the worker, and without it names are guessed. A run takes its values from the API when it starts and is refused, with a
  message, if they cannot be had. Deleting a test case now deletes its parameter values. **Before upgrading, take a SQL backup;
  restart the API (it applies the migration) and the worker.**
- **Parameter views now read by the .NET API** (stage 3b): `GET /api/parameters`, `/api/parameters/{caseId}` and
  `/api/parameters/common/{projectId}` come from the database with the same JSON. Saving and filling values stay with the worker,
  which now answers a save with `{ "saved": n }`; the web app reads the new view back. Restart the API and the worker after updating.
- **Project pages now edited by the .NET API** (stage 3a of the move): `GET/PUT /api/pages` are served, validated and audited by the API,
  with the same JSON and the same rules. After a save the API notifies the worker, which also re-reads the page list before every
  run. A page list for a project that does not exist is now refused (404). Restart the API and the worker after updating.
- **Run history now read by the .NET API** (stage 2 of the move): `GET /api/runs` and `GET /api/runs/{id}` come from the database with
  the same JSON; starting, cancelling, reports and evidence stay with the worker. The worker now announces a run change only after
  it is saved, so a page that refreshes on the event always finds it. Restart the worker after updating.
- **Custom steps, defined per project and without code:** Project settings › Custom steps lets a project build its own reusable
  steps from the standard ones (inputs plus a body). They appear in every step list of that project, so the action list no
  longer depends on one hard-coded application. Older application steps keep running but are no longer offered for new steps.
- **Step editor redesigned:** each step is a card with a plain-words sentence ("Click button “Delete” in the dialog") and labelled
  fields; application steps are forms instead of a JSON box; a "How steps work" guide explains steps for beginners.
  Worker capability `custom-steps`: restart the worker after updating.
- **Parameters with an outdated worker:** the tab lists the values the steps read, gives the exact restart command and a
  "Try again" button, and is no longer reported as "Parameter missing". `npm run worker` now rebuilds before starting, so a
  restart always runs the current code.

### Redesign — 2026-11-09

- **New navigation**, grouped the way testers work: Overview (Dashboard) · Test design (Test Design, AI Assistant) · Execution (Test
  Execution, Run History) · Integrations (Azure DevOps) · Administration (Projects & Versions, Sign-in Users, Settings). Old
  `#/test-cases` and `#/test-data` links open Test Design.
- **New look and responsive shell:** "Indigo night" palette, collapsible desktop sidebar, tablet icon rail, phone drawer and bottom bar,
  header showing group › page.
- **Test Cases split into two pages.** _Test Design_ generates cases (Excel, AI preview-then-save, by hand, Azure DevOps), reviews them
  (convert, AI draft, fix, parameters) and marks them ready. _Test Execution_ lists only ready cases and runs them, as one user or as
  **concurrent users**. The Imports tab is gone; conversion progress shows on the Generate tab.
- **Dashboard redesigned:** six KPIs, pass-rate trend, latest-result and readiness donuts, cases by project, version and priority,
  cases added per day, module coverage, recent runs, high-priority failures and the definitions behind every number (Recharts).
- **Project versions:** create releases per project, file and filter cases by version, one current version per project
  (`/api/project-versions`, `/api/test-cases/assign-version`).
- **Test data page removed; parameters are now per test case,** editable on both pages, with auto-fill from the old values, the AI or
  a guess from the name (`/api/parameters`). Existing values are kept as suggestions by the migration.
- **Settings › Pages per project:** a shared list plus per-project lists; a project page overrides a shared one with the same name.
- **Sign-in Users page:** every project's users in one place, add several at once.
- **Azure DevOps integration:** import Test Plans suites, automated pipeline (import → convert → approve → parameters → run →
  publish), result publishing and a ready-to-paste Azure Pipelines step.
- **Backend:** Dapper for master data lists and dashboard aggregates (`/api/insights`), EF Core for writes (ADR 0008). Filing hints
  let imports, AI and Azure DevOps file new cases under a chosen suite and version (ADR 0009).
- **Upgrade:** run the `AddProjectVersionsRemoveTestData` migration. `/api/test-data` and the `test-data.replace` worker operation
  are removed; `DELETE /api/inventory` takes `parameters=` instead of `testData=`.

- **Each project has its own application address, environment, sign-in method and test accounts**, set in the redesigned **Master data › Projects**: a card per project showing where it runs and whether it is ready, and one setup page per project. See `docs/adr/0006-per-project-connection.md`.
- Runs use the project of each test case. The start dialog shows the chosen cases by project and offers only that project's accounts. Reports show every environment a run used.
- Settings no longer has Environment, Sign-in or Accounts. Execution, Pages, AI, Data, Audit and About stay.
- A project with test accounts cannot be deleted until they are gone.
- **.NET backend restructured, with no change to the API's routes or JSON:** one folder per use case in `Application/Features` and `API/Endpoints` (renamed from `API/Features`), rules moved into the domain, shared repository and commit services, constants for keys, and a `Limits` configuration section. See `docs/adr/0007-cqrs-and-ddd-structure.md`.
- **SonarAnalyzer now runs in every .NET build,** with warnings as errors. All findings are fixed, including S107. A session cookie is now also marked Secure automatically on any HTTPS request.
- Documentation consolidated into `docs/BACKEND.md` and `docs/FRONTEND.md`. Removed the assessment of the old C# suite and the original AI proposal.
- Upgrade: the database migration gives existing accounts to the project with the most test cases, and on first start the projects holding test cases keep the address and sign-in in use. `QA_BASE_URL`, `QA_ENV_NAME` and `QA_LOGIN_*` are starting values for that one step only.

## 0.3.0 — 2026-11-02

- **SQL Server is now the only copy of all data**, behind a new .NET 10 API (`Backend`). The SQLite file and `TC_xx.json` mirror are no longer used. See `docs/DATABASE.md`.
- **Master data:** new pages for Projects and Test suites. Every test case is filed under a suite, with filters and "Move to test suite" on the list.
- The Node API became a worker behind the .NET API. Its features are unchanged. The app now opens at http://127.0.0.1:5080.
- `apps/web` moved to `Frontend`, now a standalone package. The Node code moved to `Backend/Worker`. The project root holds only `Backend`, `Frontend` and `docs`.
- Removed the old SQLite file, scenario JSON files, test data file, source workbook and import tool (kept in a backup beside the project); the worker's page serving and `@fastify/static`.
- API responses carry `nosniff`, frame-deny and no-referrer headers again.
- New setting: `QA_INTERNAL_TOKEN` (required). Removed: `QA_DB_PATH`, `QA_SCENARIOS_DIR`, `QA_TEST_DATA`. A scenario JSON file edited by hand is no longer picked up.

## 0.2.0 — 2026-10-29

- New web app (`apps/web`): atomic design system, one light theme, popups for editing, settings sub-menu, phone layout.
- Visual step editor: edit a test case's steps without JSON; checked while typing; history with restore.
- Database is the master copy of steps; `TC_xx.json` is written after every change and read back if edited by hand.
- Generic step library (25 actions) and element finder, usable for any web application.
- Excel import converts written steps into steps in the background, with live progress and "Approve ready".
- Settings › Pages; create a test case by hand; approve many drafts at once.
- Removed the previous UI (`apps/dashboard`) and the legacy C# suite (`legacy/`); both remain in the original Git repository.
- Clear all data now also removes steps, their files and test data values, with a backup and Undo.
