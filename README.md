# QA Studio

> A data-driven web test platform. Import or write test cases, build their steps in a visual editor **without writing code**,
> run them in a real browser with **Playwright**, and review results, reports and trends. It works for any web application.

![.NET](https://img.shields.io/badge/.NET-10-512BD4?logo=dotnet)
![Node.js](https://img.shields.io/badge/Node.js-22.13%2B-339933?logo=nodedotjs)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript)
![SQL Server](https://img.shields.io/badge/SQL%20Server-required-CC2927?logo=microsoftsqlserver)
![Playwright](https://img.shields.io/badge/Playwright-runner-2EAD33?logo=playwright)

---

## Table of contents

1. [What QA Studio does](#1-what-qa-studio-does)
2. [How it works (the big picture)](#2-how-it-works-the-big-picture)
3. [Tech stack](#3-tech-stack)
4. [Repository layout](#4-repository-layout)
5. [Prerequisites](#5-prerequisites)
6. [First-time setup](#6-first-time-setup)
7. [Running the app](#7-running-the-app)
8. [Quality checks and tests](#8-quality-checks-and-tests)
9. [Configuration and secrets](#9-configuration-and-secrets)
10. [Architecture in brief (for experienced developers)](#10-architecture-in-brief-for-experienced-developers)
11. [Your first contribution (for new developers)](#11-your-first-contribution-for-new-developers)
12. [Troubleshooting](#12-troubleshooting)
13. [Further documentation](#13-further-documentation)

---

## 1. What QA Studio does

### The idea: tests are data, not code

A test step is stored as a small piece of **data**, not as a line of code. For example, _click the button named Delete_ is:

```json
{ "action": "click", "params": { "target": { "role": "button", "name": "Delete" } } }
```

- **Describe:** testers build steps from a catalog, in plain words.
- **Run:** a real browser (Playwright) performs them.
- **See:** everyone sees the same live results and evidence.

Why this matters:

- A tester can create and fix tests **without a developer**.
- The same steps work on **any web application**. Nothing is written for a specific app.
- Because steps are data, QA Studio **checks them before running**. AI-written steps go through the same checks before
  anyone relies on them.

Most of what follows comes from this idea.

### What it does

QA Studio manages **test cases** for web applications and **runs them automatically** in a real browser.

1. A tester creates test cases: by hand, from **Excel**, from **Azure DevOps**, or with **AI**.
2. Each case is made of **generic steps** such as _open this page_, _click this button_, _check this text is shown_.
3. Someone presses **Run**. A real browser performs the steps and records what happened (pass/fail, screenshots, traces).
4. Results appear on the **Dashboard** and in **Run History**.

Everything is organised **like Azure DevOps**: pick a **project**, then a **version** (like a branch); every page works inside
that project and version.

**Main screens:** Projects · Dashboard · Test Case Studio · AI Assistant · Test Execution · Run History · Azure DevOps ·
Project settings · Organization settings.

### Key features

**Writing test cases**

- **Readable step editor.** Each step reads as a sentence with its values highlighted. Missing required values are named
  in plain words. The step editor and custom step dialogs open full screen and show a checklist of what is needed to save.
- **Parameter picker.** Search, pick or create parameters with the keyboard. Parameters appear as chips showing their value.
- **Edit details and steps** of a written case in one form. If someone else saved first, you are told about the conflict.
- **Reorder test cases** by drag-and-drop or from the row menu. The order is saved.
- **"Improve with AI"** on a step shows the old and new versions side by side with the changes highlighted, so you can
  choose whether to accept.

**AI Assistant (test case generation)**

- **Chat sessions.** Generation is a conversation that keeps its history. You can start, reopen and manage sessions.
- **Attachments.** Add images, PDFs or text files (such as screenshots or specs) to a request. They are checked, previewed,
  and sent to the AI provider.
- **Coverage levels:** _Smoke_, _Standard_ or _Thorough_. Each checklist item gets one case, up to 20 cases on Thorough.
  The UI shows each case's category, whether it needs a manual check, and a coverage summary.
- **Unsaved proposals survive a reload.** They are kept per project and tab, and you are warned before closing a tab with
  unsaved work.
- AI-generated cases use the same `TC_xx` IDs as every other case.

**Running tests**

- **Three run modes:** a fresh browser window per case, one shared window, or **concurrent users**. Advanced options cover
  choosing accounts and browser/session settings. Browsers open maximized and can reuse an existing sign-in.
- **Live run view.** A progress ring, an animated result bar and a filterable case list update as the run goes.
- **Focused Test Execution page.** Compact case rows and simpler filters. A selection bar replaces the old bulk-run buttons.
- **Readable results.** Step results appear as plain sentences in the UI and in reports.

See [docs/CHANGELOG.md](docs/CHANGELOG.md) for the full history, and [docs/qa-studio-run-flow.html](docs/qa-studio-run-flow.html)
for a visual walk-through of a run.

---

## 2. How it works (the big picture)

QA Studio is **three programs** that work together:

```text
              ┌──────────────────────────────────────────────┐
              │  Browser: React + TypeScript web app         │
              └──────────────────────┬───────────────────────┘
                                     │ HTTP + live events (SSE)
                                     ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │  .NET 10 API  (http://127.0.0.1:5080)   "the front door"             │
 │  security · projects · suites · versions · test cases · dashboard    │
 │  serves the built web app · forwards everything else (YARP) ──┐      │
 └──────────────┬─────────────────────────────────────────────────┼─────┘
                │ SQL                                             │ HTTP
                ▼                                                 ▼
       ┌─────────────────┐                    ┌────────────────────────────────────┐
       │   SQL Server    │ ◄── batched ────── │  Node.js Worker (port 4000)        │
       │  (all data)     │     writes         │  Playwright runs · step engine     │
       └─────────────────┘                    │  Excel import · reports · AI · MCP │
                                              └──────────────────┬─────────────────┘
                                                                 │ drives a real browser
                                                                 ▼
                                                    the application under test
```

| Program     | Language             | Folder            | Responsibility                                                               |
| ----------- | -------------------- | ----------------- | ---------------------------------------------------------------------------- |
| **Web app** | React, TypeScript    | `Frontend/`       | What people see and click. Talks **only** to the API.                        |
| **API**     | C# (.NET 10)         | `Backend/src/`    | Owns the database and security. The **only** address the browser uses.       |
| **Worker**  | TypeScript (Node.js) | `Backend/Worker/` | Things that need Node tools: browser automation, Excel, AI, the step engine. |

> 💡 **Beginner tip:** the browser **never** calls the worker directly. The API acts as a _reverse proxy_ and forwards any
> request it does not handle itself. That is why the web app only needs one address.

---

## 3. Tech stack

| Area       | Technologies                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------- |
| Frontend   | React 18, TypeScript, Vite, Recharts, Vitest + Testing Library, axe-core (accessibility tests)     |
| API        | .NET 10, ASP.NET Core endpoints, EF Core (writes), Dapper (reads), FluentValidation, YARP gateway  |
| Worker     | Node.js 22, TypeScript, Fastify, Playwright, Zod, Vitest, npm workspaces                           |
| Database   | Microsoft SQL Server (EF Core migrations)                                                          |
| AI / Voice | Anthropic and Gemini providers, MCP server (`qa-mcp`), LiveKit voice agent (`qa-voice`)            |
| Quality    | ESLint, Prettier, SonarAnalyzer.CSharp (warnings fail the build), Azure Pipelines CI               |
| Dev tools  | Aspire AppHost (one command, hot reload, dashboard), OpenTelemetry traces across API and worker    |

---

## 4. Repository layout

```text
QA_STUDIO/
├── Backend/
│   ├── src/
│   │   ├── Core/              Domain: entities, rules, errors. Depends on nothing.
│   │   ├── Application/       Use cases: Features/<Feature>/<UseCase> (command/query + handler + response)
│   │   ├── Infrastructure/    EF Core, migrations, Dapper reads, repositories, cache, worker client
│   │   ├── API/               HTTP endpoints, security, error shape, Swagger, gateway to the worker
│   │   ├── ServiceDefaults/   OpenTelemetry for the API (on only when an OTLP endpoint is configured)
│   │   └── AppHost/           Aspire: runs everything for development with hot reload and a dashboard
│   ├── tests/
│   │   ├── QaStudio.UnitTests/
│   │   └── QaStudio.IntegrationTests/   Run against a throw-away SQL Server database
│   ├── Worker/                The Node worker (npm workspaces)
│   │   ├── services/          qa-api (worker API) · qa-mcp (MCP tools) · qa-voice (voice agent)
│   │   ├── packages/          Libraries: automation-core, execution-engine, agents, llm, reporting, ...
│   │   ├── scripts/start.mjs  Builds and starts the API + worker together
│   │   └── .env.example       Template for the worker settings (copy to .env)
│   ├── appsettings.json       API settings (no secrets)
│   ├── azure-pipelines.yml    CI quality gate
│   ├── QaStudio.sln           Visual Studio solution
│   └── qa-studio(.cmd)        One click: build, start everything, open the browser
├── Frontend/
│   └── src/
│       ├── app/               App shell: navigation, access gate, lazy-loaded pages
│       ├── design-system/     Atoms → molecules → organisms → templates (no API calls)
│       ├── features/          One folder per page, each with its own api.ts
│       └── shared/            HTTP client, live updates, hooks
└── docs/                      Guides, architecture decisions (adr/), changelog
```

---

## 5. Prerequisites

Install these once:

| Tool                                      | Version         | Check with            |
| ----------------------------------------- | --------------- | --------------------- |
| [Node.js](https://nodejs.org/)            | 22.13 or newer  | `node -v`             |
| [.NET SDK](https://dotnet.microsoft.com/) | 10.x            | `dotnet --version`    |
| EF Core CLI                               | matches .NET 10 | `dotnet ef --version` |
| SQL Server (Express or Developer is fine) | 2019 or newer   | SSMS or `sqlcmd`      |
| Git                                       | any recent      | `git --version`       |

Install the EF Core CLI if `dotnet ef` is not found:

```bash
dotnet tool install -g dotnet-ef
```

---

## 6. First-time setup

### 6.1 Clone the repository

```bash
git clone https://github.com/tmadushan95/QA_STUDIO.git
cd QA_STUDIO
```

### 6.2 Configure the database connection

Open `Backend/appsettings.json` and set `ConnectionStrings:QaStudio` to **your** SQL Server, for example:

```json
"QaStudio": "Server=localhost\\SQLEXPRESS;Database=QaStudio;Integrated Security=True;Encrypt=True;TrustServerCertificate=True"
```

> Prefer not to edit the file? Set the environment variable `ConnectionStrings__QaStudio` instead.

### 6.3 Create the local secret files (git-ignored)

These files hold secrets, so they are **not in the repository**. Each developer creates their own.

**a) `Backend/appsettings.Development.json`**

```json
{
  "Database": { "ApplyMigrationsOnStartup": true },
  "Worker": { "InternalToken": "<32+ random characters>" }
}
```

**b) `Backend/Worker/.env`**: copy the template and edit it.

```bash
cp Backend/Worker/.env.example Backend/Worker/.env
```

Set `QA_INTERNAL_TOKEN` to **the same value** as `Worker:InternalToken` above. This shared token is how the API and the worker
trust each other.

Generate a random token (PowerShell):

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

> The encryption key (`Backend/Worker/data/secret.key`) is created automatically on first run. **Back it up**: without it,
> stored passwords and AI keys cannot be decrypted.

### 6.4 Create the database

```bash
cd Backend
dotnet ef database update --project src/Infrastructure --startup-project src/Infrastructure
cd ..
```

In Development, pending migrations are also applied when the API starts.

### 6.5 Install dependencies

```bash
cd Backend/Worker && npm install
cd ../../Frontend && npm install
cd ..
```

Install the Playwright browser once (from `Backend/Worker`):

```bash
npx playwright install chromium
```

---

## 7. Running the app

### Option A: one click (recommended)

- **Windows:** run `Backend\qa-studio.cmd`
- **macOS / Linux:** run `./Backend/qa-studio`

It builds everything, starts the API and the worker, and opens **http://127.0.0.1:5080**.

### Option B: one command

```bash
cd Backend/Worker
npm start
```

Then open **http://127.0.0.1:5080**. Press `Ctrl+C` to stop.

### Option C: frontend development with hot reload

Start the backend first (option A or B), then in another terminal:

```bash
cd Frontend
npm run dev
```

Open **http://localhost:5173**. Vite forwards `/api` to the API on port 5080.

### Option D: everything with hot reload and a dashboard (Aspire, for developers)

One command starts the API, the worker, the Vite dev server (and, if switched on, the voice agent), each with hot reload:

```bash
dotnet run --project Backend/src/AppHost
```

Or open `Backend/QaStudio.sln` in Visual Studio, set **QaStudio.AppHost** as the startup project and press F5.

| Part         | Hot reload                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------- |
| .NET API     | `dotnet watch` (from Visual Studio: its own hot reload and debugger)                               |
| Worker       | `tsc --watch` recompiles, `node --watch` restarts it (a restart cancels runs in progress)          |
| Voice agent  | Same as the worker. Off by default: set `QaStudio:Voice` to `true` (needs LiveKit in `Worker/.env`) |
| Frontend     | Vite hot module replacement                                                                        |

The **Aspire dashboard** opens at **http://localhost:15080**. It shows each process's state, console logs and health, plus
**traces**: one request followed from the API through the gateway to the worker and back. Open the app at
**http://localhost:5173**, as in option C.

- Install dependencies first (`npm ci` in `Backend/Worker` and `Frontend`). The AppHost never runs `npm install`.
- It uses the same database as the API (`Backend/appsettings.json`). To use a scratch database, give the AppHost
  `ConnectionStrings__QaStudio`. For a throw-away SQL Server container (needs Docker), set `QaStudio__SqlContainer=true`.
- Settings are in `Backend/src/AppHost/appsettings.json`: ports, `HotReload`, `Frontend`, `Voice` and `SqlContainer`.
- Stop the API in Visual Studio first: both listen on port 5080, and `dotnet watch` builds into the folder VS locks.
- This is for development only. Testers still start QA Studio with option A or B. Why:
  [ADR 0012](docs/adr/0012-aspire-for-development-and-observability.md).

### After the app starts

1. Open **Projects** (the start page) and create a project.
2. In **Project settings**, set the application URL and sign-in method, then add versions.
3. Add test accounts in **Sign-in users**.
4. Browser and speed options are in **Organization settings › Execution**.

> Values in `.env` are only **starting values**; anything saved in the app wins.

Swagger (the API explorer) is at **http://127.0.0.1:5080/swagger** in Development.

---

## 8. Quality checks and tests

Run these before every pull request. CI (`Backend/azure-pipelines.yml`) runs the same checks.

| Where            | Command         | What it does                                                     |
| ---------------- | --------------- | ---------------------------------------------------------------- |
| `Backend`        | `dotnet test`   | Unit + integration tests (the build fails on **any** warning)    |
| `Backend/Worker` | `npm run check` | Type check, lint, tests                                          |
| `Frontend`       | `npm run check` | Type check, lint, tests including accessibility checks per page  |
| `Frontend`       | `npm run build` | Production build                                                 |

> Integration tests create a temporary database named `QaStudio_Test_<guid>` and drop it afterwards, so they never touch real
> data. Set `QASTUDIO_TEST_CONNECTION` to point them at another server.

---

## 9. Configuration and secrets

| File                                   | Committed? | Purpose                                         |
| -------------------------------------- | :--------: | ----------------------------------------------- |
| `Backend/appsettings.json`             |     ✅     | All API settings, **no secrets**                |
| `Backend/appsettings.Development.json` |     ❌     | Local secrets (worker token), dev overrides     |
| `Backend/Worker/.env.example`          |     ✅     | Template documenting every worker setting       |
| `Backend/Worker/.env`                  |     ❌     | Your local worker settings and keys             |
| `Backend/Worker/data/secret.key`       |     ❌     | Encryption key for stored passwords and AI keys |
| `Backend/Worker/artifacts/`            |     ❌     | Run evidence (screenshots, traces), generated   |

The root [`.gitignore`](.gitignore) also excludes `node_modules/`, `dist/`, `bin/`, `obj/`, IDE folders, logs and OS files.

> ⚠️ **Never commit secrets.** If one is committed by accident, deleting it in a later commit is **not enough**: it stays in
> git history. Rotate (change) the secret immediately.

Runs are only allowed against environments listed in `QA_ALLOWED_ENVS`; anything else (such as production) is refused.

---

## 10. Architecture in brief (for experienced developers)

- **Clean Architecture / DDD:** `Core` ← `Application` ← `Infrastructure` / `API`. The domain depends on nothing; rules live
  with the entities.
- **CQRS with an in-house dispatcher:** each use case is a command or query with one handler, run through a pipeline of
  behaviours (`Logging → Validation (FluentValidation) → Handler`).
- **Writes through EF Core** (repositories + unit of work, one transaction per command); **reads through Dapper** for master
  data and dashboard insights ([ADR 0008](docs/adr/0008-dapper-read-side.md)).
- **Vertical slices:** `Application/Features/<Feature>/<UseCase>` mirrors `API/Endpoints/<Feature>/<UseCase>`. Endpoints only
  translate HTTP into commands; they hold no business logic.
- **Strangler-fig gateway:** a YARP catch-all forwards unhandled routes to the Node worker. A route implemented in .NET wins
  over the proxy, so features migrate one at a time with **no frontend change**
  ([ADR 0010](docs/adr/0010-moving-worker-features-to-dotnet.md)).
- **Live updates:** the worker emits Server-Sent Events (`/api/events`); open pages refetch on change.
- **Generic steps:** test steps are data, validated with Zod and executed by the Playwright engine
  ([STEP-FORMAT.md](docs/STEP-FORMAT.md), [ADR 0004](docs/adr/0004-generic-steps.md)).
- **Frontend:** atomic design system + feature folders; each feature owns its `api.ts`
  ([ADR 0003](docs/adr/0003-atomic-design-feature-folders.md)).
- **Consistent errors:** every layer returns the same JSON error shape.
- **Quality bar:** warnings as errors with SonarAnalyzer, accessibility tests with axe-core, TSDoc on every export.
- **Observability in development:** an Aspire AppHost runs every process with hot reload; OpenTelemetry in the API and the
  worker joins them into one trace in the Aspire dashboard. Off in installs
  ([ADR 0012](docs/adr/0012-aspire-for-development-and-observability.md)).

Every decision and its trade-offs are recorded in [`docs/adr/`](docs/adr/).

---

## 11. Your first contribution (for new developers)

1. **Read** [docs/ARCHITECTURE-GUIDE.md](docs/ARCHITECTURE-GUIDE.md) once from start to finish. It follows one real request
   through the whole system.
2. **Run the app** locally (sections 6 and 7) and click through each screen.
3. **Create a branch** for your work:

   ```bash
   git checkout -b feature/short-description
   ```

4. **Follow the existing pattern.** Adding a backend use case? Copy the shape of a neighbouring folder; see
   [docs/BACKEND.md › Add a use case](docs/BACKEND.md#add-a-use-case). Adding a page? See [docs/FRONTEND.md](docs/FRONTEND.md).
5. **Run the checks** in section 8 until they all pass.
6. **Update the docs** in the same commit when behaviour changes, and add an entry to [docs/CHANGELOG.md](docs/CHANGELOG.md).
7. **Commit and push**, then open a pull request to `main`:

   ```bash
   git add .
   git commit -m "Add <what you did>"
   git push -u origin feature/short-description
   ```

> 💡 Run `git status` before committing. If you see `.env`, `secret.key`, `node_modules` or `bin/`, stop: something is wrong
> with the ignore rules.

---

## 12. Troubleshooting

| Problem                                     | Fix                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Port 4000 or 5080 is already in use         | QA Studio is probably already running: open http://127.0.0.1:5080 or stop the other copy.                    |
| API answers **503 `worker-unavailable`**    | The worker is not running. Start everything with `npm start` in `Backend/Worker`.                            |
| `dotnet ef` not found                       | `dotnet tool install -g dotnet-ef`                                                                           |
| Cannot connect to SQL Server                | Check the server name in `ConnectionStrings:QaStudio` and that the SQL Server service is running.            |
| Worker rejects calls from the API           | `QA_INTERNAL_TOKEN` in `.env` must equal `Worker:InternalToken` in `appsettings.Development.json`.           |
| Build fails on a warning                    | Intended: warnings are errors. Fix the warning shown (often a Sonar rule).                                   |
| Frontend type errors about shared types     | Run `npm install` in `Backend/Worker` too; the frontend reads types from `Backend/Worker/packages/shared`.    |
| Build fails with "file is locked" (Windows) | Visual Studio is holding `bin/`. Stop debugging, or build with `--artifacts-path` pointing to another folder. |
| AppHost: API fails to build or bind 5080    | The API is also running from Visual Studio. Stop it, or start the AppHost from Visual Studio (F5) instead.    |
| AppHost: no traces in the dashboard         | Wait a few seconds (spans are sent in batches) and refresh. `/api/health` and `/api/events` are not traced.  |

---

## 13. Further documentation

| Document                                                         | What it covers                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)               | Setup and running                                                |
| [docs/ARCHITECTURE-GUIDE.md](docs/ARCHITECTURE-GUIDE.md)         | **Start here if you are new**: the whole system, explained simply |
| [docs/BACKEND.md](docs/BACKEND.md)                               | .NET API (CQRS, DDD), Node worker, runs, data, safety            |
| [docs/FRONTEND.md](docs/FRONTEND.md)                             | Structure, pages, design system, quality                         |
| [docs/DATABASE.md](docs/DATABASE.md)                             | SQL Server schema and performance                                |
| [docs/STEP-FORMAT.md](docs/STEP-FORMAT.md)                       | Every generic step action and how elements are found             |
| [docs/TEST-CASES-AND-IMPORTS.md](docs/TEST-CASES-AND-IMPORTS.md) | Test Case Studio, versions, Excel/AI/Azure DevOps import         |
| [docs/AI-AND-MCP.md](docs/AI-AND-MCP.md)                         | AI features and connecting an assistant through MCP              |
| [docs/qa-studio-run-flow.html](docs/qa-studio-run-flow.html)     | Visual walk-through of what happens during a run                 |
| [docs/presentation/client-walkthrough/](docs/presentation/client-walkthrough/) | Client presentation deck (source and link to the live deck) |
| [docs/adr/](docs/adr/)                                           | Architecture decision records                                    |
| [docs/CHANGELOG.md](docs/CHANGELOG.md)                           | Release history                                                  |
| [Backend/README.md](Backend/README.md)                           | Every API setting and backend command                            |
| [Frontend/README.md](Frontend/README.md)                         | Frontend setup and scripts                                       |
