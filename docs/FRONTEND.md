# Frontend

The web app, end to end: how it is built, what each page does, how it talks to the server, and how to change it. For
what happens behind the API, see [BACKEND.md](BACKEND.md).

**Audience and job.** QA engineers and leads. The app should answer "what is ready, what broke, what do I fix next"
quickly, and let a tester build and fix test cases without ever opening JSON.

## 1. Run it

React 18, TypeScript and Vite, with no state or styling library.

```bash
npm install --prefix Frontend
```

For everything built and served at http://127.0.0.1:5080, see [GETTING-STARTED.md](GETTING-STARTED.md). For UI work with
hot reload, start the backend, then:

```bash
npm run dev --prefix Frontend
```

Open http://localhost:5173. Vite forwards `/api` to `http://127.0.0.1:5080`; set `QA_API_URL` to use another address. Pages
use relative `/api/...` addresses, so there is no base URL in the code.

Type checking reads the data shapes in `Backend/Worker/packages/shared`, so run `npm install` in `Backend/Worker` too. Those
are types only: nothing from the backend ends up in the bundle.

## 2. Structure

Atomic design plus feature folders. See [adr/0003](adr/0003-atomic-design-feature-folders.md).

```
Frontend/src/
  app/             shell, navigation, access-token gate, lazy-loaded pages
  design-system/   atoms → molecules → organisms → templates; no API calls, no business rules
  features/        one folder per page: the page, its components, its requests in api.ts
  shared/          HTTP client, live updates, router, hooks, formatting
  test/            the fake server UI tests run against
```

- **Features** import the design system from `design-system/index.ts`, and other features only through their `index.ts` or
  public files. The design system never imports from features.
- **Each component styles itself** with a co-located CSS module, using only design tokens.
- **Every export has a TSDoc comment,** which is what IDE tooltips show.

## 3. Pages

The app is organised like Azure DevOps: **choose a project first, then everything runs inside it.** The start page (`/`)
lists projects and nothing else is offered until one is opened. Inside a project the header shows
`Projects / [project ▾] / [version ▾] / page`: the project switcher opens the same page in another project, and the version
switcher works like a branch picker — chosen once, remembered per browser, applied to every page until it is changed.
"Manage versions" opens the project's settings.

- `features/master-data/ProjectScope.tsx` — `ProjectScopeProvider` reads the project from the address and the version from
  `useWorkContext`; every page calls `useProjectScope()` and none has its own project picker.
- `features/master-data/ScopeSwitchers.tsx` — the header switchers (passed to `AppLayout` as `scope`).
- Lists are scoped on the server too: `/api/dashboard`, `/api/runs` and `/api/insights` take `?projectId=&versionId=`.

The router (`shared/hooks/useRoute.ts`) uses clean paths through the History API — no `#` in the address. Links stay plain
`<a href>` elements; `useLinkNavigation` turns same-app clicks into in-page navigation, so new tabs, copy-link, the back button and
screen-reader link lists all work. The API (`MapFrontendFallback`) and Vite both answer every non-API path with the app, so deep
links and reloads open the right page. Pages keep short internal IDs (`design`, `runs`, `project-settings`…); `useRoute.ts` is the
one place that maps them to addresses, and `href('runs', id)` stays inside the current project.

| Level        | Page                  | Route                                | Feature            | What it does                                                                               |
| ------------ | --------------------- | ------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------ |
| Organization | Projects              | `/`                                  | `master-data`      | Every project as a card; open one, create, edit, delete                                    |
| Organization | Organization settings | `/settings/<section>`                | `settings`         | Execution, Pages, AI, Voice, Data & storage, Audit log, About                              |
| Project      | Dashboard             | `/project/<CODE>/dashboard`          | `dashboard`        | KPIs, trend, donuts, cases by version/priority, coverage, runs — for this project/version  |
| Project      | Test Case Studio      | `/project/<CODE>/test-cases`         | `test-case-studio` | Create (Excel, AI, by hand, Azure DevOps), review, mark ready, parameters, history, delete |
| Project      | AI Assistant          | `/project/<CODE>/ai-assistant`       | `ai-assistant`     | Prompt first, proposals as cards; write steps for existing cases; teach the app            |
| Project      | Test Execution        | `/project/<CODE>/test-execution`     | `test-execution`   | Ready cases only; parameters; run as one user or concurrent users; live strip              |
| Project      | Run History           | `/project/<CODE>/run-history[/<id>]` | `runs`             | This project's runs; one run's cases, steps, evidence and reports                          |
| Project      | Azure DevOps          | `/project/<CODE>/azure-devops`       | `azure-devops`     | Connect Test Plans, import into this project, pipeline, publish results                    |
| Project      | Project settings      | `/project/<CODE>/settings/<section>` | `master-data`      | Application & sign-in, Versions, Test suites, Parameters, Sign-in users                    |

Old addresses still work: `#/…`, `/test-design`, `/test-cases`, `/projects/3`, `/projects/versions`, `/sign-in-users` open the
page that replaced them, in the project named (an old numeric ID is rewritten to the code) or else the last project used.
Shared pieces of Test Case Studio and Test Execution live in `features/test-cases` (`useCaseLibrary`, `CaseListParts`,
`StatusFilter`, `ParametersPanel`, the editor and dialogs).

## 4. Set up a project and start a run

1. **Projects › New project** (the start page). Name, code, environment, application address and sign-in method. The address is
   checked first, so a refused one does not leave a half-made project behind. Then the new project's settings open.
2. **Project settings › Application & sign-in** shows a progress strip (Application, Sign-in, Test accounts), then a panel for each, in the order a
   person sets them up. A sticky bar saves the application and sign-in; accounts save on their own.
3. **Test accounts** belong to the project. "Test sign-in" uses what is saved, so it stays off while there are unsaved
   changes. For sign-in with a second factor, "Sign in by hand" opens a window and keeps the session.
4. **Start a run** from Test Execution. `StartRunDialog` asks the server what the chosen cases need
   (`POST /api/runs/plan`) and shows them by project, with each project's address and only its own accounts. A project that is
   not ready blocks the start and links to its page.

## 5. Talking to the server

- **Requests** live in each feature's `api.ts`, using `get` and `send` from `shared/api/http.ts`.
- **Failures** arrive as `ApiError`, with a `message` to show and `fields` to put beside each form field. See the error shape
  in [BACKEND.md](BACKEND.md#9-errors). A form keeps what was typed when a save is refused.
- **Stale edits:** forms send back the `rowVersion` they opened, so a save based on old data gets a 409 rather than overwriting
  someone else's change.
- **Loading data:** `useResource` (`shared/hooks/useAsync.ts`) holds the result, error and loading state.
- **Live updates:** `useLive` (`shared/api/live.ts`) listens to Server-Sent Events at `/api/events`. The server says what changed,
  never the data, and the page reloads what it needs. If the connection drops, screens fall back to polling.
- **Secrets are write-only:** passwords and API keys are never sent back to the browser.

## 6. Design system

One light theme ("Indigo night": navy shell, indigo primary, violet accent for AI), and no theme switch. All values live in
`design-system/tokens/tokens.css`, so a brand change is one file.

- **Colours:** page `#F4F6FB`, cards white, borders `#E2E8F2`; text `#0B1324`, `#44516A`, `#5F6B82`; primary indigo `#3B4FE4`;
  accent `#6D28D9` (AI); success `#0F7B47`, error `#D92D20`, warning `#B54708`, info `#0B6BCB`, each with a soft background;
  six categorical chart colours `--chart-1…6`. Every text and background
  pair meets WCAG AA (4.5:1).
- **Status is never colour alone:** each has a glyph and a word. `StatusBadge` is the single vocabulary.
- **Type and spacing:** type scale 12/14/16/20/24/32 px, 4 px spacing grid, 8 px radius for controls, 12 px for cards and popups.

| Level     | Components                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------ |
| Atoms     | `Badge`, `Button`, `IconButton`, `Icon`, `Checkbox`, `Select`, `TextArea`, `TextInput`, `Spinner`      |
| Molecules | `Alert`, `EmptyState`, `ProgressBar`, `SearchBox`, `Field`, `InfoTip`, `Menu`, `StatusBadge`, `Tabs`   |
| Organisms | `DataTable`, `Dialog`, `ConfirmDialog`, `PageHeader`, `Panel`, `SaveBar`, `StickyBar`, `ToastProvider` |
| Templates | `AppLayout`, `SettingsLayout`                                                                          |

### Popups (`Dialog`)

- Sizes: `sm` confirmations, `md` short forms, `lg` editors and wizards; full screen on phones; `⤢` for full screen.
- Sticky header and footer; only the body scrolls. The main button is on the right of the footer.
- Focus moves in, stays in, and returns to the opener. Escape and ✕ close; with unsaved changes closing asks "Discard
  changes?", the only popup allowed on top of another. Ctrl/Cmd+S saves.
- Wide-effect actions need typing to confirm (the number of cases, or `CLEAR`).

### Layout

Navy sidebar with labelled groups on desktop (collapsible to an icon rail, remembered per browser), icon rail on tablets, and on
phones a header menu button that opens the full menu as a drawer plus a bottom bar with Dashboard, Test Case Studio, Test Execution, Run
History and More. The header names where you are (group › page). Breakpoints are 64rem, 47.5rem and 40rem. Tables become one card
per row on phones, each cell labelled. Organization settings and Project settings use a sub-menu with one short page per topic.

**Charts** (dashboard only) use Recharts, lazy-loaded with the dashboard chunk (~122 kB gzipped), so other pages do not pay for it.
Each chart has a text alternative stating its numbers, and colours come from the chart and status tokens.
Everything works at 375 px with no sideways scrolling.

## 7. Add a page or form

1. Create `features/<name>/` with the page and its `api.ts`, then add the lazy-loaded page and its route to `app/App.tsx`.
2. Build from design system components. Add a new one to the design system only if it is general, and export it from `index.ts`.
3. Cover every state: loading, empty, error, disabled with a reason, and a clear message on success or failure.
4. Wrap each input in `Field`, which wires its label, hint and error together for screen readers.
5. Add tests against the fake server in `test/fake-server.ts`, and add the page to `app/a11y.test.tsx`.

## 8. Quality

```bash
npm run check --prefix Frontend
```

```bash
npm run build --prefix Frontend
```

- `check` runs the type check, lint and tests. UI tests use Testing Library against a fake server, so they need no backend.
- **Accessibility:** axe-core runs in the test suite on every main screen and on the case editor popup
  (`app/a11y.test.tsx`). jsdom has no layout, so contrast is not covered there. Checked by hand in a real browser, at desktop and
  375 px width.
- **Not done yet:** screen-reader walkthroughs, keyboard-only walkthroughs beyond what axe checks, and a visual regression suite.
