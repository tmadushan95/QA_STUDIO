# 0002 — TypeScript end to end, no Python hybrid

**Status:** accepted (2026-10-29); for the data and API layer, superseded by [0005](0005-sql-server-and-dotnet-api.md) (2026-11-02)

**Context.** A Python + TypeScript hybrid was considered.

**Decision.** Stay on TypeScript with Playwright for TypeScript. Playwright offers the same browsers and features in
both languages; the UI is React; and the step format is validated in the editor, the API and the runner from one zod
schema. A hybrid would add a second runtime, toolchain and CI pipeline, a bridge between API and runner, and two copies
of the step schema to keep identical. Testers write no code (steps are data), so their language does not matter.

**When to revisit.** Heavy data or ML work (flakiness analysis, test selection, self-hosted models) could be a separate
Python service behind HTTP, reading the step schema as exported JSON Schema. Never the runner.
