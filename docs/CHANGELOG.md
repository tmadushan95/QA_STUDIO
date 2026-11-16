# Changelog

## Unreleased

### Unsaved AI proposals are no longer lost when you leave the page — 2026-11-16

- **AI Assistant › Generate keeps your prompt and proposed cases** (with their ticks and edits) when you switch tabs or
  go to another page, and after a reload. They come back when you open Generate again, until you save or discard them.
  They are kept per project and per browser tab, never shared with other tabs.
- **Closing the browser tab with unsaved proposals asks first** (the browser's own "Leave site?" question).

### AI test cases cover the whole task, one check per case — 2026-11-16

- **AI Assistant › Generate has a Coverage choice:** Smoke (1–3 cases), Standard, or Thorough (including UI and
  accessibility). Until now the page always used Standard; only voice could pick another level.
- **The AI goes through a checklist** (functional, negative, permission, validation, boundary, UI, accessibility, error
  handling) and writes a separate case for each check that applies. For example, "delete a project" gives its own
  permission case and its own Delete button look case, instead of folding them into the main case.
- **Each proposed case shows its category,** and the bar above the cards lists what is covered and what is not (for
  example "Permission 1 · Not covered: Boundary, Accessibility"), so a gap shows before saving.
- **Cases only a person can judge** (colour, layout, icons) are marked **Check by eye** and saved as manual-only.
- **Saved cases carry the category** as their test type (Permission, UI, …) and as a tag, so the case list can filter them.
- **Thorough writes up to 20 cases** in two rounds of up to 10, half the checklist each, so each answer stays within the
  answer-size limit in Settings › AI assistant. A thorough request therefore uses two model calls.

### Step setup a tester can read: steps as sentences, parameters as chips — 2026-11-16

- **Test case popup opens full screen,** so every step, label and box shows in full. The header button still gives the
  smaller popup back; phones were already full screen.
- **Test Case Studio and Test Execution:** a case opens from its row menu (**⋯ › Edit steps**, or **View steps** in Test
  Execution). The ID is now plain text instead of a link that did not say what it opened.
- **Project settings › New custom step / Edit opens full screen,** with three numbered sections in order: **Name and
  description**, **What test cases fill in** and **Steps it runs**. Each input is a small card with visible labels
  ("Label shown to testers", "Name used in steps", "Type of value"), and a new input takes focus. On wide screens the
  preview and a **Ready to save?** list sit beside the form, under it on phones. The footer says what is still missing
  (for example "To save: add at least one step.") instead of only greying out Save. The two headings that both read
  "What does it do?" are now "Description" and "Steps it runs".
- **Test Execution gives the page to the list:** the **Recent runs** panel is gone (Run History has every run), and so
  are the **Concurrent run** and **Run all shown** buttons. Tick cases and use the bar that appears (Run, Concurrent run,
  Auto-fill parameters). Filters sit in one slim row: result chips, a **Search** button that opens the search box (and
  folds away when left empty), and the suite. Rows are compact (one line per case where it fits), so about ten or more
  cases show without scrolling on a 1080p screen. A run in progress shows as one slim line.
- **Run detail is a live view:** a ring with the share of cases finished, a pulsing **Live** badge and a ticking elapsed
  clock, one bar split by result (running stripes move), and a tile per result (Passed, Failed, Blocked, Running,
  Queued), all said in words as well as colour. Cases can be filtered by result; a running case shows its own clock and a
  moving accent, and its steps show as a numbered timeline. Cancel, reports and **Explain with AI** are unchanged.
- **A visible test browser opens as a full window:** Chromium starts maximized and pages use the window's real size
  (also for manual sign-in). Headless runs keep their fixed viewport, so screenshots do not change.
- **Tables re-fit their rows** when something above them goes away (such as a finished run's live strip), not only when
  the window is resized.
- **AI Assistant › Generate test cases, redesigned around one prompt box:** you type in one box with the example chips
  ("Try: …", now saying what they are about) and **Generate test cases** on its bottom edge, ringed when focused. The
  request's settings (skills, where to save, write steps) sit in one row under it. Once proposals arrive the box shrinks
  to two lines, the examples step aside and the button reads **Generate again**, so the proposals start right below it;
  if they are out of view the page scrolls to them. The count and **Save selected** stay pinned above the cards, a long
  proposal title wraps over two lines instead of being cut off, and a "Writing test cases…" state shows while the AI
  works. The same panel in Test Case Studio's "Create cases" dialog gets the same design.
- **The footer Close asks before dropping unsaved changes,** like ✕ and Escape already did. Any dialog footer button
  marked `data-dialog-close` now closes the same way.
- **A step card reads in order:** "What should this step do?" first, then its fields in two roomy columns (one on phones),
  then **What this step does**, the step in plain words. Values are highlighted, parameters show as chips with their
  current value, and a required value that is still empty reads "Role missing". Problems, notes and "Changes data" are
  badges in words. These cards are also used in Project settings › Custom steps.
- **Show or hide a step's details** with **Details**, or all at once with **Hide all details**. A hidden step shows its
  plain-words sentence, so the list reads like the whole test. Problems stay visible on a hidden step.
- **Move a step with ↑ ↓ on the card.** Focus stays on the button used, at the step's new place; a new or duplicated step
  gets focus on its action.
- **Use parameter** replaces the `{ }` drop-down. Each text box keeps its full width, with a small **Use parameter**
  action under it. It opens a searchable list of the case's parameters with their values, lined up under the field and
  scrolled into view (a bottom sheet on phones). The list works with the keyboard (arrows, Enter, Escape) and can create
  a new parameter by name instead of a browser prompt. A value that is just one parameter shows as a chip with
  **Change parameter** and ✕ (type a value instead). Text mixed with parameters keeps the text box, inserts at the cursor
  and previews the result under it.
- **Stored steps are unchanged:** parameters are still saved as `{{data.name}}` (and `{{input.name}}` in custom steps).
  No API change.

### Choose how test cases run: fresh window, same window or concurrent users — 2026-11-16

- **Start a run › How to run:** three choices replace the "Concurrent users" checkbox.
  - **Fresh window for each test case (recommended, the default):** signs in once per user, then opens every case in a
    new, signed-in window of one browser. Nothing else carries over between cases.
  - **Same window for all test cases:** signs in once per user and runs the cases in the same window, one after another.
    This is the fastest choice, but what one case leaves behind can affect the next.
  - **Concurrent users:** a separate browser for each case and user, each signing in, all at once. You now tick who signs
    in (nobody is ticked for you, unless a project has only one account) and choose **who signs in**:
    - **Different users:** each ticked user in their own browser at the same time, as before.
    - **Same user in several browsers:** each ticked user signs in to 2–8 browsers at once, and every case runs in each
      of them at the same time, for example to check a double submit from two sessions. Results and evidence are
      labelled "(browser 1)", "(browser 2)" and so on.
    - Outside this choice, one account still never runs in two browsers at once. If a sign-in fails, that account's
      other browsers don't try again.
- **Fewer sign-ins:** before, every case opened its own browser and signed in again. In the first two modes a user signs in
  once per run. If a reused sign-in no longer works (it expired, or a case signed out), the case signs in again by itself.
  Evidence (screenshots, traces, page text) is still kept per case, and sign-in still happens before tracing starts.
- **Start a run layout:** the dialog is wider, with two columns: who signs in on the left, how to run on the right. So the
  whole choice fits without scrolling. On a phone it is full screen in one column.
  - "Same window for all test cases" is shown but can't be picked for a single test case, and is labelled "Needs 2+ test
    cases".
  - "Windows at once" is asked only when there is more than one run to spread.
- **Many test accounts:** each project shows "N of M chosen". With two or more accounts it adds **Select all** and
  **Clear**. From seven accounts it adds a search box, and its list becomes a two-column grid that scrolls on its own. While
  searching, **Select shown** ticks only the matching users.
- **Worker API:** `POST /api/runs` accepts an optional `mode` (`clean` | `shared` | `concurrent`), which defaults to
  `clean`, and an optional `browsersPerUser` (1–8, `concurrent` only).

### Skills dialog says why Save skill is off — 2026-11-13

- **AI Assistant › Skills:** the Description and Instructions hints now give their minimums (3 and 10 characters, the server's
  rules). A field that is started but too short shows a message under it. Before, Save skill stayed off with no reason, for
  example with 9 characters of instructions.

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
