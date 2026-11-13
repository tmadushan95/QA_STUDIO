# QA Studio frontend

React 18 and Vite. Pages talk to one API using relative `/api/...` addresses, so there is no base URL to configure in the code.

```
src/app             The shell: grouped navigation (sidebar, phone drawer and bottom bar), access-token gate, lazy-loaded pages
src/design-system   Atoms → molecules → organisms → templates; no API calls or business rules
src/features        One folder per page, with its requests in api.ts
src/shared          HTTP client, live updates, hooks
```

## Setup

```bash
npm install
```

Type checking also reads the data shapes in `../Backend/Worker/packages/shared`, so run `npm install` in `Backend/Worker` too. Those are types only: nothing from the backend ends up in the bundle.

## Run

Everything, built, at http://127.0.0.1:5080: see [GETTING-STARTED](../docs/GETTING-STARTED.md).

For UI work with hot reload, first run the backend ([Backend/README.md](../Backend/README.md)), then:

```bash
npm run dev
```

Open http://localhost:5173. Vite forwards `/api` to `http://127.0.0.1:5080`; set `QA_API_URL` to use another address.

## Checks

```bash
npm run check
```

Type check, lint, and tests including accessibility checks on every main page.

```bash
npm run build
```

## Conventions

See [docs/FRONTEND.md](../docs/FRONTEND.md): structure, pages, the design system and how to add a page. Every export has a TSDoc comment, which is what IDE tooltips show.
