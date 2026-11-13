# 0010 — Moving worker features to the .NET API, in stages

**Status:** accepted (2026-11-10), stage 1 done. Extends [0005](0005-sql-server-and-dotnet-api.md) and [0008](0008-dapper-read-side.md).

## Context

The Node worker (about 12,000 lines, 42 test files) runs Playwright, reads Excel, calls the AI, owns the step library and also
serves some data features. The .NET API stores everything in SQL Server and forwards what only the worker can do (the gateway).
Two programs are one more thing to start, version and keep in step (the "worker is out of date" problem), so we want the worker
to shrink to what truly needs Node. A single big-bang rewrite would risk sign-in handling, concurrent runs and the step engine
(its Zod schemas drive validation and the editor's forms), so we move it **one slice at a time**.

## Decision

Move a feature only when it passes all of these:

1. **Same contract.** The web app keeps calling the same route with the same JSON. The gateway lets any route the API
   implements win over its catch-all, so the switch is the new endpoint existing; the frontend does not change.
2. **The API already holds the data** the feature reads, or the worker can read it from the API without a stale copy.
3. **Characterised first.** The worker's own tests for the feature are ported to .NET and pass before the Node code is deleted,
   so the move is shown to change no number.
4. **Then delete.** The Node route, code and tests go in the same change. No feature is served twice.

What stays in Node for now, with the reason: Playwright runs and sessions, the step library and custom steps (the Zod-driven
engine), Excel import and reports, AI and step writing. They have no cheap .NET equivalent that keeps the editor's forms and
validation in one definition.

## Stages

| Stage | Feature                                                                                       | State                                                    | What it needs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | **Dashboard** (`GET /api/dashboard`)                                                          | **Done**                                                 | Nothing: it only reads cases, runs and approved scenarios, which are already in SQL. `DashboardBuilder` is the old `buildDashboard` ported rule for rule (8 unit tests carried over), `DashboardReader` reads with Dapper, 3 integration tests.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2     | **Run history reads** (`GET /api/runs`, `GET /api/runs/{id}`)                                 | **Done**                                                 | The API returns the stored run document as it is and adds only a summary, so anything the worker adds to a run passes through. A list for one project keeps only that project's results (`RunDocuments`, 5 unit tests). Because the history is now read from the database, the worker announces a run change **after** it is committed (`storage.flush()` before the live event); starting and cancelling a run already waited for the commit. Starting, cancelling, reports and evidence files stay in Node.                                                                                                                                                                         |
| 3a    | **Project pages** (`GET/PUT /api/pages`)                                                      | **Done**                                                 | The API edits, validates (rules ported to `PageList`, unit-tested) and audits the page list, and keeps it as the same config blocks (`pages`, `pages:<projectId>`) the worker already read. The worker no longer holds a copy it could not see changes to: after every save the API sends a **config change notice** (`POST /internal/sync/config`, with the value) and the worker also takes the blocks again from the database before each run (`GET /internal/persistence/config?prefix=pages`), so a missed notice can never run a test against old pages. The starting pages are saved once by the worker at start-up, so the database holds them and the API needs no defaults. |
| 3b    | **Parameters: what the pages read** (`GET /api/parameters`, `/:caseId`, `/common/:projectId`) | **Done**                                                 | The API computes a case's parameters, the missing-values summary and a project's common list from the scenario (draft first) and the two config blocks, with the same JSON (`ParameterViews`, 11 unit tests carried over; 4 integration tests). Saving and filling stay in the worker, so the worker now answers a save with only `{ saved }` and the web app reads the new view back from the API: the presentation logic exists once.                                                                                                                                                                                                                                               |
| 3c    | **Parameters: writes, AI filling, backup/clear**                                              | **Done**, see [0011](0011-parameter-values-in-tables.md) | Values are rows in two tables (migrated from the old blocks, which stay until stage 3d). The API is the only writer, fills values (`GuessValue` in .NET, the AI asked through one worker route) and supplies a run's values on request. The worker keeps only the AI call.                                                                                                                                                                                                                                                                                                                                                                                                            |
| 4     | Azure DevOps (connection, import, publish)                                                    | Later                                                    | Plain HTTP, but the import → convert → approve → run pipeline calls worker features, so .NET would orchestrate and call the worker for those steps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 5     | Everything else                                                                               | Only if there is a reason                                | A full move is a rewrite of the step engine and Playwright runner; decide separately, with the tests carried over each time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Why parameter writes were held back (3c)

Reading parameters was a clean slice. Writing them is not, for reasons found while looking at the code:

- **One JSON document, many writers.** Every case's values live in one config block (`case-parameters: { caseId: { name: value } }`), rewritten as a whole. Besides a person's edit, it is also written by auto-fill, by restoring a backup, by "clear all data" and by pruning deleted cases. Two programs writing one whole-document block would lose each other's changes.
- **The run path reads it.** `valuesFor` supplies a case's values to every run, so it needs the notice-and-refresh pair from stage 3a for a second block as well.
- **AI and guessing stay in Node**, so a split would call back and forth between the programs for one action (auto-configure).

The sound way is to move the values into **rows** (`CaseParameters(CaseCode, Name, Value)`, `ProjectParameters(ProjectId, Name, Value)`) with a data-preserving migration from the blocks, then let the API be the only writer and have the worker's backup, clear and prune call it. That is a database change with a restore path to test, so it is its own stage and should not be rushed into this one.

## Consequences

- Each stage shrinks the worker without touching the risky parts, and can be released and rolled back alone.
- Stage 3a added the pattern every later stage of this kind reuses: **the API owns a config block and tells the worker (notice), and the worker re-reads it before it acts (refresh)**. The worker's page list is read-only now.
- Stage 2 removed the worker's two run-read routes and the project-scope helper; its tests now read runs from the run manager, and the same rules are covered by the .NET unit and integration tests.
- Stage 1 removed the worker's dashboard route, code and nine tests; the numbers are covered by the ported unit tests and
  integration tests against a real SQL Server.
- The worker still starts separately; making the API start and watch it is a separate, small change.
