# 0013 — The MCP server covers the whole platform

**Status:** accepted (2026-11-18), phases 1–5 implemented; see "Implementation notes" for where the build differs
from the plan and what is still open. Extends the MCP section of [AI-AND-MCP.md](../AI-AND-MCP.md). Builds on
[0002](0002-typescript-only.md), [0005](0005-sql-server-and-dotnet-api.md) and [0010](0010-moving-worker-features-to-dotnet.md).

## Context

`Backend/Worker/services/qa-mcp` gives an MCP client (Claude Code, Claude Desktop, Cursor, VS Code and others) nine tools
over stdio: `search_test_cases`, `get_test_case`, `list_actions`, `search_knowledge`, `get_scenario`,
`save_scenario_draft`, `list_runs`, `get_run`, `start_run`. It keeps no data of its own and calls the platform over HTTP
with the admin token. Its tests use an in-memory MCP client against a fake API.

What an agent cannot do today:

- **Most of the platform is missing.** The .NET API has 44 endpoints (projects, versions, suites, test cases,
  parameters, pages, dashboard, insights, audit) and none of them are tools. The worker's AI features (cases from a
  prompt, failure diagnosis, step revision, AI jobs, skills) and imports are missing too.
- **It reads a stale route.** The web app reads test cases from the .NET `/api/test-cases`. The MCP tools still call
  the worker's older `/api/inventory`. `get_test_case` also searches 50 rows and filters them instead of fetching one.
  This drift can give an agent a different answer than the dashboard shows.
- **Text only.** Every result is a JSON string. There is no `outputSchema` or `structuredContent`, no resources, no
  prompts and no pagination cursor.
- **Local only.** It runs over stdio, so it works only for agents on the same machine.
- **Writes are not traceable to the agent.** The audit trail has no actor. The only marker is the `[via MCP]` prefix in
  a draft's note.

`QA_API_URL` already defaults to `http://127.0.0.1:5080`, the .NET edge. The YARP gateway forwards every `/api` route
the API does not answer to the worker (`:4000`), and the API's own routes win. **One base URL therefore covers both
backends.** That is the key fact behind this design.

## Decision

Grow the existing TypeScript server. Do not write a second server.

1. **Stay in TypeScript, in `qa-mcp`.** ADR 0002, the existing tests and the reference MCP SDK all point to TypeScript.
   - *Rejected: the C# MCP SDK hosted inside the .NET API.* It would be in-process and could use the dispatcher directly.
     But it would split tool definitions across two languages, and the worker's AI and run features would still need
     HTTP calls. It is worth looking at again once ADR 0010 has moved most features to .NET.
   - *Rejected: generating tools from Swagger.* That gives one tool per endpoint, with schema-shaped names and no
     guidance for the agent. Agents choose tools from their names and descriptions, so these are written by hand.
2. **Call only the .NET edge.** It applies the Host check, the token, the audit trail and the gateway. Fix the drift:
   test case tools call `/api/test-cases` and `/api/test-cases/{caseId}`.
3. **Organise tools around tasks, not endpoints.** Aim for about 35 tools with clear verb-noun names. Each description
   says when to use the tool and what it changes. Batch operations (move, reorder, assign version, delete) each become
   one tool that takes a list of IDs.
4. **Keep the existing safety rules and make them configurable.** The rules in AI-AND-MCP.md still apply: AI writes
   drafts, a person approves them, and secrets never leave the machine. On top of them, a `QA_MCP_TOOLSETS` setting
   picks which groups of tools are registered (see below). Tools that are not allowed are never registered, so the
   agent cannot see them.
5. **Use MCP features beyond tools.** Add resources for context the agent reads, prompts for the common workflows,
   `structuredContent` with an `outputSchema` for results, and progress notifications for long jobs.
6. **Add HTTP last.** Stdio comes first. A Streamable HTTP transport comes later, for agents that are not on this
   machine.

## Tool catalogue

Every tool gets annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) and Zod input
limits, the same way the current tools do.

**Toolset `read` (always on)**

- Projects: `list_projects`, `get_project`, `list_project_versions`, `list_test_suites`, `get_test_suite`
- Test cases: `search_test_cases` (move to `/api/test-cases` with filters for project, suite, version, module and
  tag, plus a cursor), `get_test_case` (a direct GET), `get_next_case_id`
- Parameters: `get_parameter_summary`, `get_case_parameters`, `get_common_parameters`
- App knowledge: `list_pages`, `search_knowledge`, `list_actions`
- Scenarios: `get_scenario`, `get_scenario_history`
- Results: `list_runs` (filter by project and version), `get_run`, `get_run_report` (summary text from
  `/api/runs/{id}/report.md` when that format exists), `get_dashboard`, `get_insights`
- AI: `list_ai_jobs`, `get_ai_job`, `list_skills`
- Azure DevOps: `get_work_item` (a story's title, description and acceptance criteria, through the stored connection;
  new worker route)
- `list_audit`

**Toolset `author` (on by default; writes stay reviewable)**

- `create_project`, `update_project`, `create_project_version`, `update_project_version`
- `create_test_suite`, `update_test_suite`
- `create_test_case`, `update_test_case`, `move_test_cases`, `reorder_test_cases`, `assign_test_cases_version`
- `set_case_parameters`, `set_common_parameters`, `suggest_case_parameters`, `suggest_common_parameters`,
  `auto_fill_parameters`
- `save_scenario_draft` (the existing tool), `validate_scenario` (dry-run check, no write), `discard_scenario_draft`
- AI: `propose_test_cases` (`/api/ai/cases/preview`, returns proposals and writes nothing), `add_test_cases`
  (`/api/ai/cases`, adds chosen proposals tagged `ai-generated`), `generate_scenario_drafts` (`/api/ai/generate`,
  starts a job), `revise_scenario_steps`, `diagnose_failed_case`

**Toolset `operate` (on by default; touches the QA environment)**

- `plan_run` (`/api/runs/plan`, shows what would run and what is blocked), `start_run` (the existing tool),
  `cancel_run`
- `rerun_failed_cases` (runs the failed cases of a run once more, so a flaky failure is not reported as a defect)
- `start_azure_devops_pipeline` (`/api/azure-devops/pipeline`, the existing import → convert → approve → parameters →
  run → publish job) and `get_azure_devops_job` (`/api/azure-devops/jobs`)

**Toolset `defects` (off by default; writes to Azure DevOps Boards)**

- `report_defect` (new route, see "Filing bugs in Azure DevOps"): files or updates a Bug for one failed case of a run
- `list_reported_defects`: the bugs QA Studio has filed, with their Azure DevOps state

**Toolset `admin` (off by default; must be enabled explicitly)**

- `delete_test_cases`, `delete_test_suite`, `delete_project_version`, `delete_project` (`cancel_ai_job` ended up in
  `author`; see "Implementation notes")
- These need a `confirm` argument equal to the target's ID or name. They also use MCP elicitation when the client
  supports it, so the user sees a confirmation outside the model.

**Never exposed, whatever the settings:** approving or restoring a scenario directly (the only approval an agent can
cause is the existing Azure DevOps pipeline job's rule, which approves only drafts that pass every check), settings, AI keys and model
configuration, test accounts and passwords, Azure DevOps tokens, project connection strings, backups, sign-in and
sign-out, `/internal/*`. The existing test that checks the tool list for approve, delete, setting and key words
becomes a check run once per toolset.

## Resources and prompts

Resources are read-only context that the client can attach or that the agent can read:

- `qa://actions`: the step action catalogue
- `qa://docs/step-format`: [STEP-FORMAT.md](../STEP-FORMAT.md), embedded at build time
- `qa://projects/{projectId}`: a project with its versions and suites
- `qa://test-cases/{caseId}`: a test case
- `qa://runs/{runId}/report`: a run report

The templates use the `complete` capability, so clients can autocomplete IDs.

Prompts are the platform's workflows, each one a ready-made instruction set that calls the tools in order:

- `generate-cases-from-requirement` (requirement text, project): propose cases, show them, add the chosen ones
- `automate-test-case` (case ID): read the case and actions, write a draft, validate it, report what is left for the
  reviewer
- `triage-failed-run` (run ID): diagnose each failed case and classify it as an out-of-date test or a likely defect
- `coverage-review` (project, version): use the dashboard and insights to list untested modules and cases without
  approved scenarios

## Engineering details

- **Code layout.** Split `src/tools.ts` into `src/tools/<area>.ts` (projects, test-cases, parameters, scenarios, runs,
  ai, insights), each exporting `register(server, api, opts)`. Add `src/resources.ts`, `src/prompts.ts` and
  `src/toolsets.ts`. `createMcpServer(api, options?)` keeps its current signature; the new argument is optional. Move
  `text`, `fail`, `q` and `enc` to `src/result.ts` so they are not copied into each file.
- **API client.** Add `DELETE` to `Api.send`. Read the error code (`body.error.code`) as well as the message, so a tool
  can tell the agent what to do next (for example, "worker-unavailable: start the worker"). Send an
  `X-QA-Client: mcp/<version>` header on every call.
- **Results.** Return `structuredContent` with an `outputSchema` alongside the text, so newer clients get typed data and
  older ones still work. Trim large payloads: list tools return summaries plus a `nextCursor`, and step lists and
  failure logs are capped with a note saying more is available.
- **Long jobs.** `start_run` and `generate_scenario_drafts` return at once with an ID. When the client sends a
  `progressToken`, the server follows `/api/events` (SSE) for that ID and sends `notifications/progress`, up to a time
  cap. Otherwise the agent polls `get_run` or `get_ai_job`. Use MCP tasks once the SDK and clients support them.
- **Attachments.** `propose_test_cases` takes requirement text inline. Files arrive as resource links or base64 with a
  size cap that matches the worker's `withFiles` limit, and are sent on as multipart.
- **Traceability (.NET change, small).** Record the `X-QA-Client` header as the actor in the audit trail, so
  `list_audit` and the dashboard show what an agent did. Today the audit has no actor, so this is the one backend change
  the plan needs. It is optional for phase 1.
- **Configuration.** Environment variables `QA_API_URL`, `QA_ADMIN_TOKEN` (already used), `QA_MCP_TOOLSETS`
  (default `read,author,operate`), `QA_MCP_PROJECT_ID` (optional default project, so the agent does not have to ask
  every time), and `QA_MCP_TRANSPORT` (`stdio`, the default, or `http`).

## Transport and distribution

- **Stdio (phases 1–3).** Ship a `.mcp.json` at the repository root for Claude Code. Document the Claude Desktop config
  and `claude mcp add`. Package an `.mcpb` bundle (a Claude Desktop extension) with a manifest that asks for the URL and
  token and stores the token in the OS keychain. Optionally ship a Claude Code plugin that bundles the server with
  slash commands built from the four prompts.
- **Streamable HTTP (phase 4).** Use the SDK's `StreamableHTTPServerTransport` on `/mcp`, bound to loopback by default.
  Validate `Origin`, as the MCP spec requires and as `ApiSecurityMiddleware` already does for `/api`. Protect it with
  the bearer token. A shared or remote deployment (claude.ai custom connectors need public HTTPS) needs OAuth 2.1 under
  the MCP authorization spec, with per-user tokens. That is a separate decision, because the platform currently has one
  admin token and no users.

## Where it runs

The server holds no data, so it runs wherever the platform API can be reached. Azure DevOps builds, publishes and runs
it in pipelines. It does not host a server that is always on.

- **On each person's machine (phases 1–3).** The agent starts the server over stdio. A pipeline publishes the package
  to an Azure Artifacts npm feed, so people install it with `npx @qa-studio/qa-mcp` and need no checkout.
- **Inside an Azure Pipeline job (phase 5).** A headless agent starts the server for one run and it stops with the job.
  See the next section.
- **A shared server on Azure (phase 4 and later).** Azure Container Apps running the HTTP mode, next to a hosted
  platform: the .NET API, the worker in a Playwright image and Azure SQL. It uses Microsoft Entra ID for OAuth and can
  sit behind Azure API Management. This needs the platform to accept a non-loopback host, serve HTTPS and know its
  users, so it waits on open question 2.

## Agents in Azure Pipelines

A pipeline runs an agent with no one at the keyboard (Claude Code with `-p`, Gemini CLI or any MCP client that can run
without a person). The agent has this server and only the tools the job needs.

**Triggers:** a user story moves to the state the team picks (for example "Ready for QA"), a pull request merges, or a
build is deployed to the QA environment.

**Flow for a story:**

1. Read the story's acceptance criteria. The pipeline passes them in, or `get_work_item` reads them (this needs the
   Work Items read scope the connection already has).
2. `propose_test_cases`, then `add_test_cases` under the project, suite and version the pipeline names.
3. `generate_scenario_drafts`, then `validate_scenario`. Approval follows the existing Azure DevOps job rule: a draft is
   approved only when every check passes. Drafts that fail stay drafts and are listed in the job summary for a person.
4. `auto_fill_parameters`, then `start_run`, then `get_run`.
5. For each failed case: `rerun_failed_cases` once. If it still fails, call `diagnose_failed_case`.
6. If the diagnosis is "likely defect", call `report_defect`. If it is "out-of-date test", the corrected draft waits
   for review and no bug is filed.
7. Publish the results to Test Plans (the existing publish stage) and write a summary to the pipeline log.

**Flow for a deployment:** the same as steps 4 to 7, for the approved cases of the deployed project version.
`start_azure_devops_pipeline` already does the import-to-publish part as one job.

**Pipeline setup:**

- The job runs on a **self-hosted agent** that can reach the platform, or the platform is hosted (see "Where it runs").
  Microsoft-hosted agents cannot reach a platform on `localhost`.
- The model key, `QA_ADMIN_TOKEN` and `QA_API_URL` come from a variable group linked to Key Vault. They are never
  written in the YAML.
- The agent is limited to this server's tools (for example `--allowedTools "mcp__qa-studio__*"` for Claude Code) and
  to the toolsets `read,author,operate,defects`. It never gets `admin`.
- The job fails when the platform reports an error. A failed test does not fail the job; a filed defect does, so a
  build cannot pass with open new defects. The team can change this per pipeline.
- A template file, `pipelines/qa-agent.yml`, ships with the repository. It is not tested until phase 5.

## Filing bugs in Azure DevOps

The bug comes from the platform, not from text the model writes. The agent passes only the run ID and case ID.

**New route (worker, in `azure-devops.ts`):** `POST /api/azure-devops/defects` with `{ runId, caseId }`. It reuses
the stored connection and the encrypted token. The token needs **Work Items read & write** in addition to the scopes
it has today. The Settings page must say so, and connecting with the old scope must still work for import and publish.

**What the bug contains:**

- Title: `[QA Studio] <case ID> <case title>: <failing step action>`
- Repro steps: the case's preconditions and its steps up to and including the failing one, with the parameter values
  (secrets removed, the same filter that is used before calling a model)
- The expected result, the actual failure message and the diagnosis summary
- Links to the run in QA Studio and to its screenshot or trace. Attachments are added when the run has them, within
  a size cap.
- Linked work items: the Azure DevOps test case (for `ADO-<id>` cases) and the story that started the pipeline,
  when known
- Area path, iteration and severity from the connection's defaults, and tags `qa-studio` and `ai-filed`
- State New, left for a person to triage

**Rules:**

- **Only real defects.** The route refuses a case that did not fail twice, or whose latest diagnosis is not "likely
  defect".
- **No duplicates.** A failure signature is made from the case ID, the failing step and the normalised failure
  message. If an open bug with that signature exists, the route adds a comment with the new run instead of filing
  another bug.
- **A cap.** At most N new bugs per run (a setting, default 5). After that the summary lists the rest for a person.
- **Recorded.** Every filed or commented bug is written to the audit trail, with the actor `mcp` and the bug ID.
  `list_reported_defects` reads them from there.

**Rejected: giving the agent Microsoft's Azure DevOps MCP server and letting it write bugs itself.** That is less
code, but the content and the duplicate check would depend on the model, the bugs would not be in the audit trail,
and agents without that server could not file bugs at all.

**Not in this decision:** pushing AI-created test cases to Azure DevOps Test Plans. Sync is one-way today (Azure
DevOps to QA Studio). Writing test case work items back is a separate decision.

## Testing

- Extend `tools.test.ts` (the fake API plus `InMemoryTransport`): one test per tool for the route, method, body, the
  trimmed result and the error path. Add the "never exposed" check per toolset.
- **Route contract test.** Read every route the tools use and fail the build if a route is in neither `ApiRoutes.cs`
  nor the worker's `app.ts`. This stops the `/api/inventory` drift from coming back.
- One integration smoke test against a running API on spare ports (see the memory note on building while Visual
  Studio is open): list projects, create a case, save a draft, plan a run.
- Manual check with MCP Inspector.
- A small agent eval: about ten realistic requests (for example "automate TC_12", "why did the last run fail?", "add
  cases for the login requirement") run through Claude Code. Check that the right tools are picked and no
  out-of-scope write happens.
- Defect filing: worker tests with a fake Azure DevOps API for the refusal rules (did not fail twice, not a likely
  defect), the duplicate comment, the cap, secret removal from repro steps, and an old token without write scope.
- Pipeline: one run of `pipelines/qa-agent.yml` on a self-hosted agent against a test Azure DevOps project, ending with
  a filed bug and a duplicate run that only adds a comment.

## Phases

1. **Fix and restructure.** Split files, add shared helpers, switch to `/api/test-cases`, add `structuredContent`,
   add the route contract test. Same nine tools, no behaviour change apart from the drift fix.
2. **Read toolset and resources.** Every read tool, plus resources with completion. Low risk; agents become useful
   for analysis straight away.
3. **Author and operate toolsets, and prompts.** Writes, the AI case flow, diagnosis, run planning, progress
   notifications, toolset gating, the `X-QA-Client` audit actor, `.mcp.json`, the `.mcpb` bundle, and an update to
   AI-AND-MCP.md.
4. **Admin toolset and HTTP.** Confirmed deletes with elicitation, Streamable HTTP on loopback, and a decision on
   remote OAuth.
5. **Azure Pipelines and defects.** The `defects` route and toolset, `get_work_item`, `rerun_failed_cases`, the
   Azure DevOps job tools, publishing the package to Azure Artifacts, and the `pipelines/qa-agent.yml` template. It
   needs phases 1–3, not phase 4, because a pipeline uses stdio on a self-hosted agent.

Each phase leaves `npm run check` (typecheck, lint, tests) green in `Backend/Worker` and changes nothing in the web
app.

## Consequences

- Any MCP client can drive the whole platform through the same validation, gateway and audit as the dashboard, with no
  second copy of business logic.
- The approval gate and secret handling stay exactly as they are, and the toolset setting lets a team choose how much
  an agent may do.
- About 35 tools is near the size where agents start choosing badly. Toolsets keep the default set smaller, and the
  descriptions must be written and checked with the eval.
- Each new API endpoint now raises the question "should this be a tool?". The route contract test only catches routes
  that were removed or renamed, not new ones that are missing.

## Implementation notes (2026-11-18)

Built as planned, with these differences:

- **Long jobs:** `wait_for_run` and `wait_for_ai_job` poll the API every 3 seconds (up to 15 minutes) and send
  `notifications/progress` when the client asks for progress. They do not follow `/api/events`: polling the same
  routes is simpler, works through the gateway unchanged, and is enough for jobs that take seconds to minutes.
- **Results:** every tool returns `structuredContent` beside the text, but declares no `outputSchema`. A declared
  schema makes the SDK reject any answer that differs from it, and the platform's answers are richer than the
  summaries; adding schemas tool by tool is a follow-up.
- **Schema compatibility:** a test fails the build if any tool's input schema uses `anyOf`, `oneOf`, `allOf` or
  `$ref`, which Gemini-based clients reject. Parameter values are therefore plain strings (an empty string clears a
  value) instead of nullable ones.
- **Toolsets:** `cancel_ai_job` is in `author` (it stops a job; it deletes nothing). `validate_scenario`,
  `suggest_*_parameters` and `propose_test_cases` save nothing and are marked read-only.
- **Secrets:** parameter answers mask values whose name looks secret (`[hidden]`), with the same pattern the API
  uses when guessing values.
- **Audit:** both backends append `(via mcp)` to the detail of changes a request with `X-QA-Client: mcp/…` causes,
  instead of a new actor column, so no migration was needed. The worker carries the client through background work
  started by the request (AsyncLocalStorage); the API reads the header per request (`IRequestClient`).
- **Defects:** the latest diagnosis per run and case is remembered in memory (bounded); after a worker restart a case
  must be diagnosed again before a bug is filed. The bug settings (`bugAreaPath`, `bugIterationPath`, `bugSeverity`,
  `maxBugsPerRun`) are API-only for now, and saving the Settings page keeps them.
- **Not done:** the `.mcpb` bundle for Claude Desktop (the server is registered by command instead), OAuth for a
  shared remote server (open question 2), and an end-to-end run of `pipelines/qa-agent.yml`. The route contract test
  checks that every route a tool calls exists; the "agent eval" is still manual.

## Open questions

1. Should the admin toolset (deletes) exist at all, or should deletion stay in the dashboard only?
2. Is a shared or remote server needed (team members, claude.ai)? If so, user identity and OAuth come first.
3. Does the worker's `/api/inventory` have any remaining role, or can it be retired under ADR 0010 once the MCP server
   stops calling it?
4. Should a filed defect fail the pipeline by default, or only be reported?
5. Which Azure DevOps state should trigger the story flow, and should AI-created test cases also be written back to
   Test Plans (a separate decision)?
