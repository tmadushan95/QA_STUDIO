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

| Where                                                      | What                                                                                     | What it changes                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Test cases → **Generate** (row or bulk)                    | Drafts the automation for a case                                                         | A draft per case, for review                                                       |
| Test cases → **Create test cases from a prompt**           | Proposes cases from a description, one per checklist category (up to 10; 20 on Thorough) | Nothing until you tick and add them; they get `AI-` IDs and the `ai-generated` tag |
| AI Assistant → Generate → **Skills** (`/skill-name`)       | Saved instructions (or an imported `SKILL.md`) applied to a prompt                       | Only the proposals; skills shape wording and scope, never the safety rules         |
| Runs → failed case → **Ask AI why it failed**              | Says whether the test is out of date or the app is likely wrong                          | A corrected draft only for an out-of-date test; a likely defect changes nothing    |
| Settings → AI assistant → **Teach the assistant your app** | Reads pages of the app (no clicks, no typing)                                            | Adds the page text to the private search index                                     |

Reading pages is enforced as read-only in the browser: after sign-in, every request that is not a read (`GET`, `HEAD`,
`OPTIONS`) is refused, and the count is shown. A page that loads its data with `POST` may therefore look partly empty.

## MCP server (for Claude Code, Claude Desktop or any MCP client)

`services/qa-mcp` exposes the platform as MCP tools over stdio. It holds no data: every tool calls the running
platform's API, so the same validation, audit trail and safety switches apply.

| Tool                                                                                                             | Kind                                                                              |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `search_test_cases`, `get_test_case`, `list_actions`, `search_knowledge`, `get_scenario`, `list_runs`, `get_run` | read only                                                                         |
| `save_scenario_draft`                                                                                            | writes a **draft** (marked "via MCP"); never runs until approved in the dashboard |
| `start_run`                                                                                                      | runs approved scenarios in real browsers against the configured QA environment    |

There is deliberately **no** tool to approve a scenario, delete anything, change settings or read a key.

Start the platform (`qa-studio` or `npm start`), build once (`npm run build`), then register the server with your client.
For Claude Code, a project `.mcp.json`:

```json
{
  "mcpServers": {
    "qa-studio": {
      "command": "node",
      "args": ["services/qa-mcp/dist/server.js"],
      "env": { "QA_API_URL": "http://127.0.0.1:5080" }
    }
  }
}
```

If the platform has an access token (`QA_ADMIN_TOKEN`), add the same variable to `env`. Keep that file out of version
control when it holds a token.

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
