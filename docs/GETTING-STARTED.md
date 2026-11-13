# QA Studio

Generic, data-driven web test platform (QA Studio): import Excel test cases, build their steps in a visual editor without code, run them with Playwright, and review results, reports and trends. It works for any web application.

## Quick start

Requires Node.js 22.13 or newer, the .NET 10 SDK and SQL Server.

First time only: set up the database and settings as described in [Backend/README.md](../Backend/README.md), set `QA_INTERNAL_TOKEN` in `Backend/Worker/.env`, and install dependencies:

    cd Backend/Worker && npm install
    cd ../../Frontend && npm install

Then, on Windows, run `Backend\qa-studio.cmd`, which builds, starts and opens your browser (`Backend/qa-studio` on macOS/Linux). Or, without the shortcut:

    cd Backend/Worker && npm start     # builds, then runs the API and the worker; open http://127.0.0.1:5080

After updating an existing install, apply the database migration once: `dotnet ef database update --project Backend/src/Infrastructure --startup-project Backend/src/Infrastructure`
(or set `Database:ApplyMigrationsOnStartup` to `true` for one start).

Then open **Projects** (the start page), open each project and in **Project settings** give it its application address and sign-in method, add its versions,
and add its users in **Sign-in users**. Browser and speed are in **Organization settings › Execution**. Values in `.env` are only starting values; anything saved in the app wins. Press Ctrl+C to stop.

If you see that port 4000 or 5080 is already in use, QA Studio is probably already running: open http://127.0.0.1:5080, or stop the other copy.

Checks: `npm run check` in `Backend/Worker` and in `Frontend`; `dotnet test` in `Backend`.

## Layout

- `Backend/src`, `Backend/tests`: .NET 10 API over SQL Server (Projects, Test suites, Test cases, audit), the only address the browser uses; serves the built web app and forwards the rest to the worker. See [Backend/README.md](../Backend/README.md).
- `Backend/Worker`: the Node worker. `services/qa-api` is its API (Playwright runs, Excel, step validation, AI, live events) and `services/qa-mcp` its MCP tools; `packages/` holds the libraries behind them. It keeps no data on disk apart from run evidence and the encryption key.
- `Frontend`: React app (Projects start page; inside a project: Dashboard, Test Case Studio, AI Assistant, Test Execution, Run History, Azure DevOps, Project settings; Organization settings), atomic design system. See [Frontend/README.md](../Frontend/README.md).
- `docs`: start at [README.md](README.md).

Secrets belong in `.env` (git-ignored) or a secret manager. Never commit them.

CI runs from `Backend/azure-pipelines.yml`. How each side is built and checked: [BACKEND.md](BACKEND.md) and [FRONTEND.md](FRONTEND.md).
