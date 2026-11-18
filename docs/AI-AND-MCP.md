# AI features and the MCP server

What the AI does here, what it may not do, and how to connect an AI assistant to the platform.

## The rules every AI feature follows

1. **The test case is never changed by AI.** Generation writes a separate scenario linked to the case ID.
2. **AI writes drafts; a person approves.** Only approved scenarios run. An approved scenario is never edited in place:
   a fix is a new draft next to it, and the old version keeps running until the new one is approved.
3. **Only registered actions.** Every step is checked against the action registry, the same check a hand-written draft
   gets. Problems are listed; a draft with problems cannot be approved.
4. **No secrets leave the machine.** API keys and test-account passwords are removed from everything sent to a model.
   Keys are stored encrypted and are never returned by the API.
5. **Budgets.** Each task has a cap on model calls and answer size (Settings → AI assistant → Spending limits).

## Features

| Where                                                      | What                                                                                     | What it changes                                                                                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Test cases → **Generate** (row or bulk)                    | Drafts the automation for a case                                                         | A draft per case, for review                                                                                                            |
| Test cases → **Create test cases from a prompt**           | Proposes cases from a description, one per checklist category (up to 10; 20 on Thorough) | Nothing until you tick and add them; they get the next IDs in the project's own format (`TC_01`, `TC_02`, …) and the `ai-generated` tag |
| AI Assistant → Generate → **Skills** (`/skill-name`)       | Saved instructions (or an imported `SKILL.md`) applied to a prompt                       | Only the proposals; skills shape wording and scope, never the safety rules                                                              |
| Runs → failed case → **Ask AI why it failed**              | Says whether the test is out of date or the app is likely wrong                          | A corrected draft only for an out-of-date test; a likely defect changes nothing                                                         |
| Settings → AI assistant → **Teach the assistant your app** | Reads pages of the app (no clicks, no typing)                                            | Adds the page text to the private search index                                                                                          |

Reading pages is enforced as read-only in the browser: after sign-in, every request that is not a read (`GET`, `HEAD`,
`OPTIONS`) is refused, and the count is shown. A page that loads its data with `POST` may therefore look partly empty.

## MCP server (for Claude Code, Claude Desktop or any MCP client)

`services/qa-mcp` exposes the whole platform to an AI assistant as MCP tools, resources and prompts. It holds no
data: every tool calls the .NET API (which forwards the worker's routes), so the same validation, audit trail and
safety switches apply. Changes it makes are marked "(via mcp)" in the audit trail. The design is in
[ADR 0013](adr/0013-mcp-server-for-the-whole-platform.md).

### Tools, in toolsets

`QA_MCP_TOOLSETS` picks which groups are offered (default `read,author,operate`). A tool outside them is never
registered, so the assistant does not see it.

- **read** (always on): `list_projects`, `get_project`, `list_project_versions`, `list_test_suites`,
  `get_test_suite`, `list_pages`, `search_test_cases`, `get_test_case`, `get_next_case_id`, `get_parameter_summary`,
  `get_case_parameters`, `get_common_parameters`, `list_actions`, `search_knowledge`, `get_scenario`,
  `get_scenario_history`, `validate_scenario`, `list_runs`, `get_run`, `get_run_report`, `wait_for_run`,
  `list_ai_jobs`, `get_ai_job`, `wait_for_ai_job`, `list_skills`, `get_dashboard`, `get_insights`, `list_audit`,
  `get_work_item`, `get_azure_devops_job`. Secret-looking parameter values are shown as `[hidden]`.
- **author**: create and update projects, versions, suites and test cases; move, reorder and assign versions;
  set and suggest parameters; `save_scenario_draft` and `discard_scenario_draft`; `propose_test_cases` (saves
  nothing) and `add_test_cases`; `generate_scenario_drafts`, `revise_scenario_steps`, `diagnose_failed_case`,
  `cancel_ai_job`.
- **operate**: `plan_run`, `start_run`, `rerun_failed_cases`, `cancel_run`, `start_azure_devops_pipeline`.
- **defects** (off by default): `report_defect`, `list_reported_defects`. See "Filing bugs" below.
- **admin** (off by default): `delete_project`, `delete_project_version`, `delete_test_suite`,
  `delete_test_cases`. Each needs the target named again in `confirm`, and the client asks the person to confirm
  when it supports MCP elicitation.

Whatever is turned on, there is **no** tool to approve, edit or restore an approved scenario, or to change settings,
keys, test accounts or connections. Approval stays with a person in the dashboard; the only automatic approval is
the existing Azure DevOps job's rule (drafts that pass every check).

**Resources:** `qa://actions`, `qa://docs/step-format`, `qa://projects/{projectId}`, `qa://test-cases/{caseId}` and
`qa://runs/{runId}/report`. **Prompts** (slash commands in most clients): `generate-cases-from-requirement`,
`automate-test-case`, `triage-failed-run`, `coverage-review`.

### Connecting an assistant

Start the platform (`qa-studio` or `npm start`) and build once (`npm run build` in `Backend/Worker`). The
repository's `.mcp.json` registers the server for Claude Code. For other clients use the same command and variables:

- **Claude Code**: the repository's `.mcp.json`, or
  `claude mcp add qa-studio --env QA_API_URL=http://127.0.0.1:5080 -- node <repo>/Backend/Worker/services/qa-mcp/dist/server.js`
- **Claude Desktop, Cursor, VS Code, Windsurf**: their MCP settings file, `mcpServers` → `qa-studio` →
  `command: "node"`, `args: ["<repo>/Backend/Worker/services/qa-mcp/dist/server.js"]`, `env` as below.
- **Gemini CLI**: `mcpServers` in `~/.gemini/settings.json` (or the project's `.gemini/settings.json`), same shape.
- **Google Antigravity and other agents**: their MCP server settings, same command.

Settings (environment variables):

- `QA_API_URL`: the .NET API, default `http://127.0.0.1:5080`.
- `QA_ADMIN_TOKEN`: the platform's access token, when it has one. Pass it from your environment; never commit it.
- `QA_MCP_TOOLSETS`: see above.
- `QA_MCP_PROJECT_ID`: the project to use when the assistant does not name one.
- `QA_MCP_TRANSPORT=http` serves Streamable HTTP on `http://127.0.0.1:5090/mcp` (`QA_MCP_HTTP_PORT`) instead of
  stdio, for clients that cannot start a process. It listens on this machine only, checks `Origin`, and requires
  `Authorization: Bearer <QA_MCP_HTTP_TOKEN>` when that variable is set (set it). A shared server for other
  machines needs per-user sign-in first (ADR 0013, open question 2).

### Filing bugs in Azure DevOps

With the `defects` toolset, `report_defect` files a Bug for a case that failed in a run. The platform builds the bug
from the test case and the run (repro steps, failing step, expected and actual, evidence, screenshot), never from
model text, and masks tokens. It refuses unless the case **also failed in an earlier run** (use
`rerun_failed_cases`) and `diagnose_failed_case` said **likely-defect** for this run since the worker started. An
open bug with the same failure gets a comment instead of a duplicate, a run files at most `maxBugsPerRun` new bugs
(default 5), and every bug is in the audit trail (`azure-devops.defect`). The Personal Access Token needs **Work
Items read & write** for this; import and publish keep working with the old scopes. Optional settings in the
`azure-devops` config block: `bugAreaPath`, `bugIterationPath`, `bugSeverity`, `maxBugsPerRun`. They are not on the
Settings page yet: set them with `PUT /api/azure-devops`; saving the Settings page keeps them.

`pipelines/qa-agent.yml` is a template for an Azure Pipeline that runs an assistant with this server for a story or
after a deployment. It needs a self-hosted agent that can reach the platform.

## Voice control

Talk to QA Studio: open pages, fill in forms, run test cases, change settings and generate test cases by voice.
Anything a person can do with a mouse and keyboard, voice can do, and it carries out every step with the same code a
click runs, so validation, permissions and confirmations are exactly the same.

**How it fits together.**

```
Browser                         qa-api (worker)                 LiveKit                    qa-voice (worker)
  mic ─ wake phrase (on device)
  Ctrl+Space / voice button ──► POST /api/voice/session ──► token for one room ──► room ◄── agent dispatched
  speaker ◄──────────────────────────────────────────────── agent voice ◄──────────── STT → LLM + tools → TTS
  runs commands ◄───────────────────────────────────────── RPC "qa.command" ◄──────── tool calls
```

- `services/qa-voice` is the agent (LiveKit Agents for Node, TypeScript like the rest of the worker; see ADR 0002).
  Speech recognition, the language model and the voice all run through LiveKit Inference, so it needs no provider keys
  of its own. It only understands speech and decides what to do.
- The browser carries out each command (`features/voice/commands.ts`): read the screen, open a page, click, type,
  choose, tick, press a key, or run an app action a page offers (`useVoiceAction`, for example `cases.generate` on the
  AI Assistant). The contract is `packages/shared/src/voice.ts`.
- Test cases by voice can start with clarifying questions: `POST /api/ai/cases/ask` lets the model ask up to two
  questions when the description leaves out something that changes the cases. Coverage (smoke, standard, thorough) and
  format (steps, Gherkin) tune the same generator the AI Assistant uses.

**Safety, enforced in the browser, whatever the model asks.**

- A control that deletes, removes, clears, discards or restores (danger buttons, or those words in its name) is only
  pressed after the user says yes to that exact action.
- Voice never types into password fields, API key or token fields, or type-to-confirm boxes. The user types them.
- Voice controls themselves are never targets, and saving generated cases always needs the user's confirmation.

**Set up.**

1. Create a LiveKit project (LiveKit Cloud or self-hosted) and add to `Backend/Worker/.env`:
   `QA_LIVEKIT_URL`, `QA_LIVEKIT_API_KEY`, `QA_LIVEKIT_API_SECRET`. Optional: `QA_VOICE_STT_MODEL`
   (default `deepgram/nova-3`) and `QA_VOICE_TTS_MODEL` (default `cartesia/sonic-2`).
2. `npm run build` in `Backend/Worker`, then `npm start` starts the voice agent with everything else. On its own (for example next to `npm run worker`):
   `npm run voice`.
3. Settings › Voice: turn voice on, choose push to talk or the wake phrase, and the generator defaults.

**Wake phrase.** Detected in the browser with ONNX Runtime Web (`features/voice/wakeword`); audio leaves the browser
only after the phrase is heard. Put the models in `Frontend/public/models/`:

- `melspectrogram.onnx` and `embedding_model.onnx`, the openWakeWord front end;
- `<phrase id>.onnx`, for example `hey_qa_studio.onnx`, trained with
  [livekit-wakeword](https://github.com/livekit/livekit-wakeword) from
  `Backend/Worker/services/qa-voice/wakeword/hey_qa_studio.yaml`.

Until they are there, the voice button says "Wake model not installed" and push to talk keeps working. Use the
"Test wake phrase" meter in Settings › Voice to pick a sensitivity for your voice and room.
