# Test design, parameters and imports

How test cases are created, filed, made ready and given the values they need. Everything happens inside **one project and
version**, chosen like an Azure DevOps project and branch: open a project from the start page, then pick the version in the
header (`Projects / [project ▾] / [version ▾]`). The pages are **Test Case Studio** (create and review) and **Test Execution** (run
what is ready). See [FRONTEND.md](FRONTEND.md) for the page map.

## Projects, versions and test suites

**Project settings** (bottom of the menu inside a project) has a section each for **Application & sign-in**, **Versions**, **Test
suites**, **Parameters** and **Sign-in users**. Every test case belongs to one project, is filed under one suite and may carry one
**version** (a release such as 2.4 or Sprint 18). One version per project can be **current**.

Every list (Test Case Studio, Test Execution, Run History, Dashboard) shows the header's project, and its version unless "All
versions" is chosen. New cases — from Excel, the AI, by hand or Azure DevOps — are filed in that project, under the chosen suite (or a
suite per module) and the chosen version. The header is the only project picker; no page has its own.

Select cases and use **Move** or **Set version** to re-file them. Deleting a version keeps its cases (with no version). A project with
suites or test accounts, or a suite holding test cases, cannot be deleted. API: `GET/POST/PUT/DELETE /api/project-versions`,
`POST /api/test-cases/assign-version { ids, projectVersionId | null }`, `GET /api/test-cases?projectVersionId=`; `POST
/api/test-cases` accepts `projectVersionId`, and `/api/dashboard`, `/api/runs`, `/api/insights` accept `?projectId=&versionId=`.

## Test Case Studio: create, then review

One primary button, **Create test cases**, asks **where** (the header's project; a required version; an optional suite, else "By
module") and **how**:

- **Import from Excel** — upload, check detected columns and the preview, then import the chosen sheets.
- **Generate with AI** — describe a feature; the AI proposes cases as cards; edit titles, untick the ones you do not want, **Save
  selected**. Proposals live in the browser until then. The same generator is the first tab of the **AI Assistant**.
- **Write by hand**, or **From Azure DevOps** (see below).

Saved cases are converted into runnable steps in the background; the activity strip shows each job live.

Below, one row of counted status chips (All, No steps, Needs fixing, To approve, Ready to run) filters the list, with search and suite
in a sticky toolbar and more filters (priority, module, missing parameters) folded away. Selecting cases turns the toolbar into the
bulk bar: **Mark ready**, **Write steps** (from their text or with AI), **Auto-fill parameters**, and under ⋯ **Set version**,
**Move**, **Delete**. Each row's ⋯ menu has Edit steps, Parameters, **History**, Write steps, Set version, Move and **Delete**
(the case and its steps go; past run results stay in Run History). Ready cases move to Test Execution.

The converter understands sentences such as "Go to the Draft projects page" (when that page is in Settings › Pages), "Open
/projects", "Enter PRJ-1 in the Search field", "Select Open from the Status dropdown", "Click the Delete button", "Verify 'Saved' is
displayed". Sign-in sentences are left out (the run signs in). It never guesses.

The AI writes the parts it can automate and lists the rest as **"Check by hand: …"** instead of refusing the whole case; "Needs a
manual check" is shown only when the expected result itself cannot be checked in a browser.

## Editing a test case

Click a case's ID. The popup has five tabs:

- **Steps** — the visual step editor; checked as you type (`POST /api/scenarios/validate`). "Insert parameter" adds
  `{{data.name}}` to a text field, including "＋ New parameter…".
- **Details** — the case as written. **Parameters** — this case's values (below). **Runs** and **History** (with Restore).

**Saving** writes with the version the editor opened (`PUT /api/scenarios/:caseId`). Valid steps become the next approved version;
steps with problems stay a draft while the last valid version keeps running. A save based on stale data gets HTTP 409
(`changed-since-opened`) and the editor offers to reload.

## Parameters

Steps read values as `{{data.name}}`. Each value comes from one of two places, chosen per value:

| Source             | Where it is set                                   | Use it for                                                         |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------ |
| **This case**      | The case's **Parameters** tab (or a row's ⋯ menu) | A value only this test case uses                                   |
| **Project common** | **Project settings › Parameters**                 | A value every case of the project shares, such as the project code |

A case's own value wins; without one the case uses its project's common value; a value with neither **blocks** the case at run
time, naming it. The common page lists every name the project's steps read, how many cases use it and how many override it.

- In the Parameters tab each row has a **This case / Project common** switch; on "Project common" it shows the inherited value.
- **Auto-fill** fills only empty values, for you to check before saving: first the values the old Test data page held (kept by the
  migration), then the AI when a provider is set up, then a guess from the name (`ownerEmail` → `qa.<date>@example.com`, `startDate` →
  today, `projectCode` → `QA-<date>` …). Names that look like passwords, tokens or keys are never filled.
- **Auto-fill parameters** on a selection (or for every blocked case on Test Execution) fills and saves many cases at once, and
  never changes a value a person set.
- Values are plain text and are never sent to logs or the audit log. Credentials belong to sign-in users, never here.

API: `GET /api/parameters` (summary per case), `GET|PUT /api/parameters/:caseId` (each item has `source: case | common | missing`),
`POST /api/parameters/:caseId/suggest { ai }`, `POST /api/parameters/auto { caseIds, ai }`, and per project
`GET|PUT /api/parameters/common/:projectId`, `POST /api/parameters/common/:projectId/suggest`.

**"The parameters could not be loaded"** with a note that the worker is older than the web app means the Node worker was started
before the update: restart QA Studio (`npm start` in `Backend/Worker`). A banner at the top of every page says the same.

## Azure DevOps

**Integrations › Azure DevOps** connects an Azure Test Plans project with a Personal Access Token (Test Management read & write, Work
Items read; stored encrypted, never shown again). Choose a plan suite and where its cases go in QA Studio (suite, version), the users
the run signs in as, and which stages run automatically.

- **Import now** — the suite's test cases become `ADO-<work item id>` cases (title, steps and expected results from the Steps field,
  priority, tags). Importing again updates them; a case already filed elsewhere stays where people put it.
- **Run full pipeline** — import → convert → approve → fill parameters → run → publish the results to the plan as an automated test
  run, each stage shown live. One pipeline runs at a time.
- **From Azure Pipelines** — the page shows a PowerShell step that starts the pipeline with the QA Studio access token
  (`Authorization: Bearer`) and fails the build if QA Studio's pipeline fails.

API: `GET|PUT /api/azure-devops`, `PUT|DELETE /api/azure-devops/token`, `POST /api/azure-devops/test`, `GET /api/azure-devops/plans`,
`GET /api/azure-devops/plans/:planId/suites`, `POST /api/azure-devops/import`, `POST /api/azure-devops/publish`,
`POST /api/azure-devops/pipeline`, `GET /api/azure-devops/jobs`.

## Clearing all data, and undo

**Settings › Data & storage › Clear all data** removes the test cases and, unless unticked, their steps and parameters. Run history is
removed only if ticked. Confirm by typing `CLEAR`. A backup is taken first: **Undo** right away, or **Backups** within 7 days
(restoring adds data back and deletes nothing).

API: `DELETE /api/inventory?scenarios=true&parameters=true&runs=false` → `{ deletedCases, deletedScenarios, deletedFiles,
clearedValues, deletedRuns, backupId }`; `GET /api/backups`; `POST /api/backups/:id/restore`.
