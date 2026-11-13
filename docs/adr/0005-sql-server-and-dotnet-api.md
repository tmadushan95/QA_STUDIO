# 0005 — SQL Server behind a .NET API; Node stays as the execution worker

**Status:** accepted (2026-11-02). Supersedes [0001](0001-database-master-json-mirror.md) and the TypeScript-only rule of
[0002](0002-typescript-only.md) for the data and API layer.

**Context.** Test cases and everything around them should live in SQL Server, behind a new .NET backend, with projects and test
suites to categorise them. The existing Node backend also runs Playwright, parses Excel, validates steps and hosts the AI agents:
about 10,900 lines with 340+ tests.

**Decision.** .NET owns all persistence and is the only address the browser uses. It implements Projects, Test suites, Test cases and
Audit itself, and forwards everything else to a Node worker with YARP. The worker keeps its logic, holds no data on disk (run
evidence aside), and reads and writes through internal routes guarded by a shared secret.

**Rejected.**

- _Full port to C# now._ Leaves a single stack, and remains a reasonable destination. But it is a rewrite of working code whose tests
  would not carry over, so it risks every feature for no gain to users today. The gateway makes it possible one route at a time: implement
  an endpoint in .NET and it starts winning over the catch-all.
- _CRUD in .NET, with Node left on SQLite._ Two sources of truth: runs would not see edits made through .NET.
- _Worker talks to SQL Server directly._ Two schema owners and two sets of write rules.
- _Making the worker's services asynchronous._ Touches nearly every service and test. The in-memory copy with ordered write-through gave
  the same durability from one new class.

**Consequences.**

- Two processes to run (`npm start` starts both). Test case and master data pages keep working when the worker is stopped; running does not.
- Run one API and one worker per database: the worker's in-memory copy does not see writes from a second instance until its next run or start.
- The security checks moved to the .NET edge with the same behaviour; the worker stays on loopback.
- `Mediator`, `FluentValidation`, EF Core and YARP are the new dependencies. The mediator is a small in-house class, since the popular
  library went commercial and only a fraction of it is needed.

**Patterns, and why each earns its place.** Clean Architecture for the dependency direction (API and Infrastructure → Application → Core).
Vertical slices so a feature's request, validator and handler sit together. REPR (Request-Endpoint-Response) for endpoints, one class per route.
Repository and Unit of Work so handlers can be tested without EF. CQRS as a light split: commands use tracked repositories, queries use no-tracking readers.
Mediator with Decorator behaviours for validation and logging. Decorator again for the master data cache. Strategy for worker operations, so a new
kind of write does not touch the dispatcher.
