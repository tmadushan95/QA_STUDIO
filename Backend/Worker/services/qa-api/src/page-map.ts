/**
 * The application's pages, as configured in Settings › Pages: a name testers use in steps ("Draft projects"), its
 * address, and a text that shows the page has loaded. Steps say "Go to page Draft projects" instead of repeating
 * addresses, so a route change is fixed in one place.
 *
 * The lists are edited through the API (`/api/pages`) and kept in the database; this service only reads them, laid out as the
 * run engine needs them. Pages are mapped per project: a shared list applies to every project, and each project can add its own pages or
 * override a shared one by giving the same name. A run of a case uses its own project's merged list, so two
 * applications can both have a page called "Dashboard" at different addresses.
 */
import { z } from 'zod';
import type { PageSpec } from '@qa-studio/automation-core';

export interface PageMapStore {
  loadConfig(key: string): unknown;
  saveConfig(key: string, value: unknown): void;
}

const KEY = 'pages';
const Entry = z.object({
  name: z.string(),
  route: z.string(),
  marker: z.string().default(''),
});

/** Storage key of a project's own list (the shared list keeps the original key, so existing setups keep working). */
const keyOf = (projectId?: number) => (projectId ? `${KEY}:${projectId}` : KEY);

export class PageMapService {
  /**
   * @param initial Pages to start with when nothing was saved yet (an existing setup keeps its routes).
   */
  constructor(
    private readonly store: PageMapStore,
    private readonly audit: (action: string, target: string, detail: string) => void,
    private readonly initial: Record<string, PageSpec> = {},
  ) {}

  /** One saved list as name → spec; the shared list falls back to the starting pages until something is saved. */
  private own(projectId?: number): Record<string, PageSpec> {
    const saved = z.array(Entry).safeParse(this.store.loadConfig(keyOf(projectId)));
    if (!saved.success) return projectId ? {} : { ...this.initial };
    return Object.fromEntries(
      saved.data.map((p) => [p.name, { route: p.route, marker: p.marker }]),
    );
  }

  /**
   * Pages as the run engine needs them: name → route and loaded text. With a project, its own pages are laid over the
   * shared ones, matching names without regard to case, so steps can say "Dashboard" whatever the project.
   */
  map(projectId?: number): Record<string, PageSpec> {
    const shared = this.own();
    if (!projectId) return shared;
    const mine = this.own(projectId);
    const overridden = new Set(Object.keys(mine).map((n) => n.toLowerCase()));
    return {
      ...Object.fromEntries(
        Object.entries(shared).filter(([n]) => !overridden.has(n.toLowerCase())),
      ),
      ...mine,
    };
  }

  /**
   * Save the starting pages as the shared list when nothing was saved yet, so the database (which the API edits the list
   * in) holds them like any saved list. An existing setup keeps its routes; a list that was saved is never touched.
   */
  seed(): void {
    if (this.store.loadConfig(KEY) === undefined) {
      this.store.saveConfig(
        KEY,
        Object.entries(this.initial).map(([name, s]) => ({
          name,
          route: s.route,
          marker: s.marker,
        })),
      );
    }
  }
}
