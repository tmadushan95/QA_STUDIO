# 0011 — Parameter values in tables, owned by the API (stage 3c of the move)

**Status:** accepted and built (2026-11-12). Continues [0010](0010-moving-worker-features-to-dotnet.md) stage 3c. The owner approved the plan and its four answers (one coordinated release, `guessValue` in .NET, keep the old blocks for a release, deleting a case deletes its values).

## Context

Stage 3b moved what the pages **read** about parameters to the API. Writing them stayed in the worker because the values live in
one JSON document with several writers. This plan removes that obstacle and finishes the move.

What exists today (found by reading the code, not assumed):

| Fact                                                                                                                                                                                                                                     | Where                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Every case's values are one config block, `case-parameters: { caseId: { name: value } }`; each project's common values are another, `project-parameters: { projectId: { name: value } }`. Both are rewritten as a whole on every change. | `Worker/services/qa-api/src/parameters.ts`          |
| Writers of that block: a person's save, auto-fill (single and many cases), restoring a backup (`replace`), "clear all data" (`clear`), and `prune`.                                                                                      | `parameters.ts`, `backups.ts`, `app.ts`             |
| **`prune()` is never called.** Deleting a test case leaves its values behind in the block. This is a latent bug this plan fixes.                                                                                                         | `app.ts` (only the type mentions it)                |
| A run reads values through `valuesFor(caseId)` from the worker's in-memory copy, at the moment each case starts.                                                                                                                         | `server.ts` (`getData`)                             |
| Auto-fill order: the retired Test data page (`legacy-test-data`), then the AI, then a guess from the name. The AI call needs Node; the guess (`guessValue`, about 25 lines of pure code) does not.                                       | `parameters.ts`, `ai-tasks.ts`                      |
| Backups store a snapshot document that includes `parameters: { caseId: {…} }`. Old snapshots must still restore.                                                                                                                         | `backups.ts`                                        |
| Values are limited to 200 names per case and 500 characters; names match `^[A-Za-z][\w-]{0,99}$`; empty values are dropped.                                                                                                              | `parameters.ts`                                     |
| The last data migration (`AddProjectVersionsRemoveTestData`) already copied values between config blocks in SQL, so the pattern and its risks are known.                                                                                 | `Backend/src/Infrastructure/Persistence/Migrations` |

## Decision

1. **Values move into rows.** Two tables replace the two blocks:
   - `CaseParameterValues (CaseCode, Name, Value, UpdatedAtUtc)`, primary key `(CaseCode, Name)`. No foreign key to `TestCases`,
     the same choice as scenarios (a value outlives a case only until the case is deleted, and the delete handler removes it).
   - `ProjectParameterValues (ProjectId, Name, Value, UpdatedAtUtc)`, primary key `(ProjectId, Name)`, foreign key to `Projects`
     with cascade delete.
   - `legacy-test-data` stays a read-only config block: it is only a source of suggestions and is never written.
2. **The API is the only writer.** It owns saving (per case and common), the missing-values logic it already has from stage 3b,
   audit entries, and the orchestration of auto-fill.
3. **The worker keeps only what needs Node:** asking the AI for values. Everything else about parameters leaves it.
4. **A run never trusts a standing copy.** Before it builds its jobs, `POST /api/runs` asks the API for the effective values
   (the case's own value over the project's common one) of the chosen cases. There is no in-memory copy to go stale, so no
   change notice is needed, and a failed lookup refuses the run with a clear message instead of running with wrong values.
5. **`guessValue` is ported to .NET** with its tests, so auto-fill without the AI works even when the worker is stopped. Only
   the AI step calls the worker.

## The design

### Who does what after the change

```text
 Browser ─► API  GET  /api/parameters, /{caseId}, /common/{projectId}      read from rows (3b logic, simpler SQL)
         ─► API  PUT  /api/parameters/{caseId}, /common/{projectId}        validate, replace rows in one transaction, audit
         ─► API  POST /api/parameters/auto, /{caseId}/suggest, /common/{projectId}/suggest
                       │ API works out the missing names and context (it has both)
                       │ legacy values (config) ─► guess (.NET) ─► [optional] worker: POST /internal/parameters/ai-suggest
                       ▼
                 saves only values a person has not set; answers the same JSON as today

 Run:  POST /api/runs (worker) ─► API  POST /internal/persistence/parameters/effective { caseIds }   fail closed on error
 Backup: take    worker ─► API GET  /internal/persistence/parameters/export   (snapshot format unchanged)
         restore worker ─► API POST /internal/persistence/parameters/import   (adds to what exists, as today)
 Clear all data: worker ─► API DELETE /internal/persistence/parameters
 Delete test cases / project: the API deletes the values in the same transaction (case) or by cascade (project)
```

The PUT routes answer with the full view again, as they did before stage 3b, so the web app's extra read-back in
`saveParameters` / `saveCommonParameters` is removed. The route and JSON contract of every `/api/parameters…` route stays
identical, so no screen changes.

### The migration

An EF Core migration `MoveParametersToTables`:

- **Up:** create both tables and indexes; copy rows from the two blocks with `OPENJSON` (outer key = case or project, inner key =
  name); skip empty values, names that fail the rule, values over 500 characters and cases that no longer exist; leave the
  original blocks **untouched**. It is idempotent (re-running it adds nothing).
- **Down:** write the blocks back from the rows (`FOR JSON`), so a rollback keeps edits made after the upgrade.
- **Runbook:** a SQL backup first (as for the last migration), then a verification query that compares the number of values in
  each block with the number of rows. The blocks are removed only in a later release (stage 3d), after the new release has run
  in real use.

### One coordinated release, not three

Splitting writes from reads would need a bridge that keeps the blocks and the tables in step (a dual write). That doubles the
surface that can go wrong. The change is therefore built in three reviewable parts that ship **together**:

| Part                  | Contents                                                                                                                                                                                                                                                                | Can be tested alone by                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1. Data               | Entities, EF configuration, migration, repository, parity of the 3b reads against rows                                                                                                                                                                                  | Migration tests on a seeded database; the 3b integration tests unchanged and green |
| 2. API                | PUT routes, validation (ported from the worker's schema), replace semantics, audit, case-delete cleanup, internal routes (effective, export, import, clear), auto-fill and suggest orchestration, `GuessValue`                                                          | Unit and integration tests                                                         |
| 3. Worker and web app | `POST /api/runs` takes effective values from the API; backup, clear and the Azure pipeline's "fill missing parameters" call the API; the worker's routes and stores for parameters are removed; AI endpoint added; capability list updated; web app drops the read-back | Worker tests with a fake API; UI tests                                             |

## Tests (written first for each part)

- **Migration:** seeded blocks become the expected rows; empty, invalid, oversized and orphaned entries are skipped; running
  twice changes nothing; `Down` rebuilds blocks equal to the originals.
- **Rules ported from the worker's tests:** bad name names its field (`values.1x`); empty values are dropped; over 200 names is
  refused; unknown case 404; clearing a value falls back to the common value; a project's common values never reach another
  project's cases.
- **Auto-fill:** keeps what a person set, reports what is still missing, never fills a password-like name, legacy value before AI
  before guess, AI failure still fills by guess, works with the worker stopped when the AI is off.
- **Case delete and project delete** remove their values (new behaviour, covered).
- **Backups:** a snapshot taken before the change restores into the tables; a snapshot taken after restores the same.
- **Run path:** values come from the API; a failed lookup refuses the run (503, clear message) and starts nothing; a stale
  worker copy cannot be used because none exists.
- **Contract:** the existing frontend tests pass with only the read-back removed.

## Risks and how each is handled

| Risk                                                     | Handling                                                                                                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Values lost in the migration                             | SQL backup first; verification counts; original blocks left in place; `Down` restores them.                                                                                                     |
| A run uses wrong or empty values                         | No standing copy; fetch before building jobs; fail closed with a message.                                                                                                                       |
| Old backups no longer restore                            | Snapshot format unchanged; tested with a fixture taken from the current format.                                                                                                                 |
| Two people edit the same case at once                    | Same behaviour as today (the last save replaces the case's values). Not widened; an optimistic version column is possible later and is not part of this stage.                                  |
| Summary is slow on large libraries                       | One set-based query with an index on `CaseCode`; measured on a seeded database of several thousand cases.                                                                                       |
| The worker is older than the API after an upgrade        | The capability list changes (`case-parameters` and `common-parameters` are removed from the worker; `parameter-ai` is added), so the web app shows the existing "worker is out of date" banner. |
| Behaviour change: deleting a case now deletes its values | Intended (it fixes the unused `prune`); stated in the changelog.                                                                                                                                |

## Out of scope

Moving the AI, the backup table, "clear all data" itself, or any other feature; removing the old blocks (stage 3d); versioning
of parameter values.

## Done when

All the tests above pass; the web app's parameter screens work unchanged against the new release in a manual check (edit a case
value, edit a common value, auto-fill with and without the AI, run a case that reads both layers, take and restore a backup,
delete a case); the verification counts match on a copy of the real database; documentation and the changelog are updated.

## Questions for the owner

1. **One coordinated release** (recommended) rather than a dual-write bridge: acceptable?
2. **Port `guessValue` to .NET** so auto-fill without the AI no longer needs the worker: acceptable?
3. **Keep the old blocks for at least one release** before removing them (stage 3d): acceptable?
4. **Deleting a case deletes its values** (fixes a leak, changes behaviour): acceptable?

## What was built, and where it differs from the plan

Built as planned: the two tables and the data-preserving migration (`MoveParametersToTables`, whose copy and rebuild SQL are
tested against a seeded database), the API as the only writer with the rules ported from the worker, `GuessValue` in .NET, the
internal routes (`effective`, `export`, `import`, `clear`, `auto`), the run asking the API before it builds its jobs and refusing
to start when it cannot, backups and "clear all data" through the API, and the web app's read-back removed (the PUT routes answer
with the full view again).

Differences, decided while building:

- **The worker's "delete test case" operation does not remove values.** The worker can delete and re-add the same ID inside one
  batch, so cascading there could erase values on a harmless re-save. Deleting a case through the API (what the web app uses) does
  remove them, in the same transaction. The worker's own `/api/inventory/delete` route, which the web app does not call, leaves
  values behind as before.
- **The worker asks for a run's values by case, once per run, instead of refreshing a standing copy.** This is simpler than the
  notice-and-refresh pair of stage 3a and removes the worker's `case-parameters`/`project-parameters` handling entirely. The
  worker capability `api-parameters` replaces `case-parameters` and `common-parameters`.

Left for the next release (stage 3d): removing the two old config blocks, after this release has run in real use.
