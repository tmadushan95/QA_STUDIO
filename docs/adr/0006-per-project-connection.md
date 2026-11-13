# 0006 — Each project has its own address, sign-in and test accounts

**Status:** accepted (2026-11-02).

**Context.** One install tests several applications, but the address, environment, sign-in method and test accounts were single
values for the whole install, kept in Settings and `.env`. Every project's test cases ran against the same address.

**Decision.**

- A project's **connection** (environment, application address, sign-in method) is a configuration block the worker owns, stored in
  `ConfigEntries` under `project-connections`, keyed by project ID. It is edited in **Projects & Versions › Projects** (formerly Master data).
- A **test account belongs to one project** (`TestAccounts.ProjectId`). Labels are unique within a project.
- Each test case runs against its own project's connection. A run may span projects; each case signs in only as chosen accounts of its
  own project. A run that touches a project not set up is refused, naming the project.
- **Browser, workers, speed and timeouts stay install-wide** (Settings › Execution): they describe the machine running the tests, not
  the application.
- On the first start after this change, the projects that hold test cases get the address and sign-in the install was using, once.
  After that, `QA_BASE_URL`, `QA_ENV_NAME` and `QA_LOGIN_*` are not read for runs.

**Rejected.**

- _Columns on `Projects`, owned by .NET._ The rules for a safe address (the production check, the allow-list from `QA_ALLOWED_ENVS`) live
  in the worker, which must re-check them at every run anyway. Validating in .NET too would be a second copy of a safety rule.
- _A project inherits the install's address until it sets its own._ A new project would silently run against another application.
- _A foreign key from `TestAccounts` to `Projects`._ The worker's writes arrive in queued batches, and a refused write loses its batch.
  Deleting a project instead refuses while it has accounts, the same rule as for its suites.

**Consequences.** Saving a new project is two requests, so the address is checked first (`POST /api/project-connections/check`). Test
data values and Settings › Pages are still shared by every project. The AI assistant's "explore" uses the first project that is set up.
