# 0007 — One folder per use case, and rules in the domain

**Status:** accepted (2026-11-02).

**Context.** Each feature of the .NET API was one large file holding every command, query, validator and handler. Rules about what
makes an entity valid lived in FluentValidation validators, so an import through the worker skipped them. Handlers repeated the
same steps after every change (save, drop the cache, tell the worker) and had grown to nine constructor parameters.

**Decision.**

- **CQRS by folder.** `Application/Features/<Feature>/<UseCase>/` holds a use case's command or query, handler, and any validator or
  response of its own. `API/Endpoints/<Feature>/<UseCase>/` mirrors it with the endpoint and request. One type per file.
- **Rules in the domain.** Entities check their own rules in their factories and update methods, and report all wrong fields together.
  FluentValidation stays only for rules about the request itself, such as a list being too long.
- **What repeats gets one home:** `IRepository<T>` and `EfRepository<T, TId>`, `MasterDataCommit`, `TestCaseCommit`, and per-feature
  response builders. Handlers now take at most six parameters.
- **Worker writes are strategies,** one class per family, each a table of kind to action, so a kind cannot be listed without being handled.
- **Keys are constants** (`ErrorCodes`, `FieldNames`, `AuditActions`, `WorkerOperationKinds`, `ApiRoutes`). How much a request may ask for
  is configuration (`Limits` section). Column sizes are constants on the entities, shared by their rules and table mappings.
- **SonarAnalyzer runs in every build,** with warnings as errors, including rules that take a threshold such as S107.

**Rejected.**

- _A `...Response` type per use case when they are identical._ Create, update and get of a project answer with exactly the same shape, so
  separate types would be copies. They share one in the feature's `Common` folder; a use case with its own answer has its own type.
- _Both FluentValidation and domain rules for the same thing._ Two copies of a rule drift apart. A required title is now checked once.
- _An enum for test case readiness._ The worker's step library owns that list and stores the text in its own documents. Constants name
  the values without making .NET fail on one it has not heard of yet. `ScenarioSlot`, which .NET stores as a number, stays an enum.
- _A generic repository exposing `IQueryable`._ It would leak EF Core into handlers.

**Consequences.** A request with several wrong fields still gets them all at once, but a rule the domain checks now runs after the handler
has looked up what it needs, so a missing parent can answer 404 before a blank name answers 400. Length errors now read "Use N characters
or fewer." A worker write that breaks a rule is now refused with a 400 and dropped with its batch, where it used to fail in SQL and be retried
forever.
