# 0008 — Dapper for flat reads and aggregates; EF Core keeps writes and the schema

**Status:** accepted (2026-11-09).

**Context.** The question was whether to replace EF Core with Dapper. The API is CQRS: commands change aggregates (`Project`,
`TestSuite`, `ProjectVersion`, `TestCase` with its steps) through repositories and a unit of work; queries only read. The new
dashboard needs GROUP BY aggregates over the whole library, and master data lists are read on almost every page.

**Decision.** Use both, each where it is strongest.

- **EF Core** stays the write side and the schema owner: aggregates with private setters and invariants, change tracking,
  `rowversion` concurrency (`ExpectVersion`), one transaction per request, migrations and seed data. The test case read model also
  stays on EF compiled/split queries, because it materialises whole `TestCase` aggregates with their steps.
- **Dapper** is the read side for flat projections and aggregates:
  - `MasterDataReader` — projects, suites and versions (three small tables, read on every page, cached by `CachedMasterDataReader`).
  - `InsightsReader` — `GET /api/insights`: counts by project, version, suite, priority and readiness, and cases added per day,
    in one round trip with `QueryMultiple`. Every query is covered by an existing index.
- Both use the same connection string, so the same SqlClient pool. `SqlConnectionFactory` reads it at first use, for the same reason
  the DbContext does: configuration is final only once the host is built (integration tests override it).

**Rejected.**

- _Dapper everywhere._ Would mean hand-writing change tracking, optimistic concurrency, cascades and migrations, and either public
  setters on entities (breaking "entities cannot be invalid") or a mapping layer per aggregate. A rewrite of working, tested code for
  no user-visible gain.
- _EF everywhere._ The aggregates translate to SQL, but load more than they need and the GROUP BY-with-joins shapes are clearer as SQL.

**Consequences.** SQL in `InsightsReader` and `MasterDataReader` must follow schema changes by hand; the integration tests
(`ProjectVersionTests.Insights_count_the_library_by_project_and_version`, master data tests) run that SQL against a real database,
so a drift fails the build. Row shapes are private records, so `byte[]` row versions never leak into read models.
