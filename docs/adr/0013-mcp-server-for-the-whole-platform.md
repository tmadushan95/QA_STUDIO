# 0013 — The MCP server covers the whole platform

**Status:** proposed (2026-11-17). Extends the MCP section of [AI-AND-MCP.md](../AI-AND-MCP.md). Builds on
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

**Toolset `admin` (off by default; must be enabled explicitly)**

- `delete_test_cases`, `delete_test_suite`, `delete_project_version`, `delete_project`, `cancel_ai_job`
- These need a `confirm` argument equal to the target's ID or name. They also use MCP elicitation when the client
  supports it, so the user sees a confirmation outside the model.

**Never exposed, whatever the settings:** approving or restoring a scenario, settings, AI keys and model
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

## Open questions

1. Should the admin toolset (deletes) exist at all, or should deletion stay in the dashboard only?
2. Is a shared or remote server needed (team members, claude.ai)? If so, user identity and OAuth come first.
3. Does the worker's `/api/inventory` have any remaining role, or can it be retired under ADR 0010 once the MCP server
   stops calling it?
