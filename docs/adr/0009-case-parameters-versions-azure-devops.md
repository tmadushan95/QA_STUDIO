# 0009 — Per-case parameters, project versions, project pages and Azure DevOps

**Status:** accepted (2026-11-09). Supersedes the shared "Test data" page; extends [0006](0006-per-project-connection.md).

## Per-test-case parameters replace shared test data

**Context.** Values for `{{data.name}}` were one install-wide list. Two cases could not use the same name with different values, a
change for one case silently changed every other, and the list was shared by all projects.

**Decision.** Each test case owns its values (`ParameterService`, config block `case-parameters`: `{ caseId: { name: value } }`).
They are edited on Test Design (before a case is marked ready) and Test Execution (before a run), or filled automatically:
old Test data values (copied by the migration into `legacy-test-data`) → the AI, when a provider is set up → a guess from the name.
Password-like names are never filled. The run reads the case's values per case, so an edit applies to the next case. The step syntax
`{{data.name}}` is unchanged, so every existing step keeps working.

**Rejected.** _Keep shared values as defaults with per-case overrides._ Two places to look for one value, and the original problem
(an edit leaking into other cases) stays for every value nobody overrode.

## Project versions

A `ProjectVersion` (name, release date, scope, current, active) belongs to one project. A case may carry one version
(`TestCases.ProjectVersionId`, `ON DELETE SET NULL`): a version is a label, not an owner, so deleting it never deletes cases. At most
one version per project is current; new cases are filed under it by the Test Design work context. A version of another project is
refused (`version-project-mismatch`).

**Filing hints.** Imports, AI cases and Azure DevOps imports are created by the worker, which only knew "file by module". The worker's
case document now carries optional `testSuiteId` and `projectVersionId`. The API honours them only when it first creates a case;
afterwards filing is a person's decision and a rewrite from the worker never moves a case.

## Settings › Pages per project

Pages are a shared list plus one list per project (`pages:<projectId>`); a project page with the same name (case-insensitive)
overrides the shared one. A run uses its case's project's merged list. The shared list keeps the original key, so existing setups
are unchanged.

## Azure DevOps

`AzureDevOpsService` talks to Azure Test Plans REST 7.1 with a Personal Access Token encrypted by the same `SecretBox` as account
passwords (never returned). It imports a plan suite's test cases as `ADO-<work item id>` (re-import updates them; steps come from the
Steps field), and publishes a finished run as an automated Azure test run on the suite's test points (worst result per work item
across accounts). The automated pipeline (import → convert → approve → fill parameters → run → publish) is a background job that
drives the same HTTP routes a person uses through `app.inject`, so every safety rule of a manual run applies. One pipeline at a time.
An Azure Pipelines YAML step (shown on the page) starts it with the QA Studio access token as a Bearer token.

**Rejected.** _Calling Azure DevOps from .NET._ The import must create worker-owned documents and the run is the worker's; putting the
integration in .NET would need a second write path for cases and a way to wait on worker runs.

## Amendment (2026-11-09): common parameters and project-first navigation

- **Two parameter layers.** A case's own value wins over its project's common value (`project-parameters` config block, edited in
  Project settings › Parameters). Shared values are set once instead of copied into every case, and a case can still override one.
- **Project first, like Azure DevOps.** The project lives in the address (`/project/<CODE>/…`) and the version in a header switcher
  remembered per browser. Pages read both from one provider and have no pickers of their own, so filing (Excel, AI, by hand, Azure
  DevOps) and every list use the same scope. The server filters too (`?projectId=&versionId=` on dashboard, runs and insights), so a
  project's numbers never include another project's results.
- **Version skew is reported, not guessed.** The worker lists its `capabilities` and answers unknown routes with
  `route-not-found`; the web app names an out-of-date worker once instead of showing "Not found" page by page.
