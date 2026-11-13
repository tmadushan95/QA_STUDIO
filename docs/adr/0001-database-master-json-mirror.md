# 0001 — The database is the master copy; TC_xx.json files are a mirror

**Status:** superseded by [0005](0005-sql-server-and-dotnet-api.md) (2026-11-02): SQL Server is now the only copy and the JSON mirror is gone.

Originally accepted 2026-10-29.

**Context.** Test cases' steps used to live only in JSON files that people edited by hand, with app-made changes kept
separately in the database. People should never need to open JSON, two people may edit at once, and every change
should be undoable.

**Decision.** SQLite holds every scenario and every earlier version. A person's save is a database write with an
expected version (a stale save gets HTTP 409). After each approved change the server writes `TC_xx.json` (write to a
temp file, then rename). At start-up, a file the database does not know, or one edited by hand, becomes the next
approved version, so Git pulls and hand edits still work.

**Rejected.** Files as the master (no safe concurrent edits, no history, slow search). Database only (loses Git/CI
friendliness).

**Consequences.** One file per case; an array file holding several cases is still read but is rewritten as one file
per case after the next save.
