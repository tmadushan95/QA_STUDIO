/**
 * A tiny router on clean paths (the History API), organised like Azure DevOps: the organization first, then one project.
 *
 *   /                                   Projects — choose (or create) the project to work in
 *   /settings/<section>                 Organization settings (how tests run on this machine, AI, data, audit)
 *   /project/<CODE>/dashboard           everything below runs inside that project
 *   /project/<CODE>/test-cases          Test Case Studio
 *   /project/<CODE>/ai-assistant
 *   /project/<CODE>/test-execution
 *   /project/<CODE>/run-history[/<runId>]
 *   /project/<CODE>/azure-devops
 *   /project/<CODE>/settings/<section>  Project settings: general, versions, test-suites, parameters, sign-in-users
 *
 * The version works like Azure's branch picker: chosen in the header, remembered per browser (`useWorkContext`), and
 * applied to every page of the project. Pages keep short internal IDs (`design`, `runs`, `project-settings`…); this file
 * is the one place that maps them to addresses, so `href('runs', id)` stays inside the current project without the
 * caller knowing which one it is.
 *
 * Links stay plain `<a href>` elements: `useLinkNavigation` turns same-app clicks into in-page navigation, while new tabs,
 * copy-link and screen-reader link lists keep working. The server answers every non-API path with the app, so deep
 * links and reloads open the right page. Old addresses (`#/…`, `/test-design`, `/projects/3`) are still understood.
 */
import { useEffect, useState } from 'react';

/** The current route, in internal page IDs. */
export interface Route {
  /** The project's code (or ID, in old links) from `/project/<CODE>/…`; absent at organization level. */
  project: string | undefined;
  /** The page, such as "design". "home" is the project list. */
  page: string;
  /** Second level, such as a settings section or a run ID. */
  sub: string | undefined;
  /** Third level. */
  detail: string | undefined;
}

/** Pages that live inside a project, with their path segment. */
const PROJECT_SLUG: Record<string, string> = {
  dashboard: 'dashboard',
  design: 'test-cases',
  ai: 'ai-assistant',
  execution: 'test-execution',
  runs: 'run-history',
  'azure-devops': 'azure-devops',
  'project-settings': 'settings',
};

/** Path segment (current or older) → internal page ID. */
const PAGE: Record<string, string> = {
  ...Object.fromEntries(Object.entries(PROJECT_SLUG).map(([id, slug]) => [slug, id])),
  'test-design': 'design',
  'test-data': 'design',
  design: 'design',
  execution: 'execution',
  runs: 'runs',
  ai: 'ai',
};

/** Project-settings sections that older addresses reached as pages of their own. */
const SETTINGS_SECTIONS = new Set(['sign-in-users', 'versions', 'test-suites', 'parameters']);

/** Whether a page lives inside a project. */
export const isProjectPage = (page: string) => page in PROJECT_SLUG;

const isNumeric = (s: string | undefined) => s !== undefined && /^\d+$/.test(s);
const ORG_HOME: Route = { project: undefined, page: 'home', sub: undefined, detail: undefined };

/** Read a route from a path. */
export function parseRoute(pathname: string): Route {
  const parts = pathname
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);
  const [first, second, third, fourth, fifth] = parts;
  if (!first) return ORG_HOME;

  if (first === 'project' && second) {
    const page = (third && PAGE[third]) || third || 'dashboard';
    return { project: second, page, sub: fourth, detail: fifth };
  }
  if (first === 'settings')
    return { project: undefined, page: 'settings', sub: second, detail: third };
  // Older addresses without a project: /projects, /projects/3, /projects/versions, /master-data/…, /sign-in-users.
  if (first === 'projects' || first === 'master-data') {
    const section = second;
    const id = first === 'master-data' ? third : second;
    if (isNumeric(id) && (first === 'projects' || section === 'projects')) {
      return { project: id, page: 'project-settings', sub: 'general', detail: undefined };
    }
    if (section && SETTINGS_SECTIONS.has(section)) {
      return { project: undefined, page: 'project-settings', sub: section, detail: undefined };
    }
    return ORG_HOME;
  }
  if (first === 'sign-in-users') {
    return {
      project: undefined,
      page: 'project-settings',
      sub: 'sign-in-users',
      detail: undefined,
    };
  }
  if (first === 'test-cases')
    return { project: undefined, page: 'design', sub: second, detail: third };
  return { project: undefined, page: PAGE[first] ?? first, sub: second, detail: third };
}

/** The project of the address currently shown, so links stay inside it. */
const currentProject = (): string | undefined => parseRoute(window.location.pathname).project;

/** Address of a page inside a given project. */
export function hrefIn(project: string, page: string, sub?: string, detail?: string): string {
  const slug = PROJECT_SLUG[page] ?? page;
  const tail = `${sub ? `/${encodeURIComponent(sub)}` : ''}${sub && detail ? `/${encodeURIComponent(detail)}` : ''}`;
  return `/project/${encodeURIComponent(project)}/${slug}${tail}`;
}

/**
 * Link target for a page. Project pages stay inside the project being shown; organization pages are absolute. Older
 * call forms are still accepted: `href('master-data', 'projects', id)` opens that project's settings, and
 * `href('master-data', 'versions')` (or `href('sign-in-users')`) the current project's settings section.
 */
export function href(page: string, sub?: string, detail?: string): string {
  if (page === 'home') return '/';
  if (page === 'settings') return `/settings${sub ? `/${encodeURIComponent(sub)}` : ''}`;
  if (page === 'master-data' || page === 'sign-in-users') {
    if (page === 'master-data' && (!sub || sub === 'projects')) {
      return detail ? hrefIn(detail, 'project-settings', 'general') : '/';
    }
    const section = page === 'sign-in-users' ? 'sign-in-users' : (sub ?? 'general');
    const project = currentProject();
    return project ? hrefIn(project, 'project-settings', section) : `/projects/${section}`;
  }
  const project = currentProject();
  if (project && isProjectPage(page)) return hrefIn(project, page, sub, detail);
  const slug = PROJECT_SLUG[page] ?? page;
  return `/${slug}${sub ? `/${encodeURIComponent(sub)}` : ''}${sub && detail ? `/${encodeURIComponent(detail)}` : ''}`;
}

const EVENT = 'qa-navigate';

/** Go to an address inside the app without reloading the page. `replace` leaves no history entry (redirects). */
export function navigate(to: string, replace = false): void {
  if (to === window.location.pathname + window.location.search) return;
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(EVENT));
}

/** An old `#/page/sub` address as a clean path, or undefined when the address has no old-style hash. */
export function fromLegacyHash(hash: string): string | undefined {
  if (!hash.startsWith('#/')) return undefined;
  const path = hash.slice(1);
  const r = parseRoute(path);
  if (r.project) return hrefIn(r.project, r.page, r.sub, r.detail);
  if (r.page === 'home') return '/';
  if (r.page === 'settings') return href('settings', r.sub);
  if (r.page === 'project-settings') return `/projects/${r.sub ?? ''}`;
  return `/${PROJECT_SLUG[r.page] ?? r.page}${r.sub ? `/${encodeURIComponent(r.sub)}` : ''}`;
}

/** The current route; updates on navigation and on the browser's back and forward buttons. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => {
    const legacy = fromLegacyHash(window.location.hash);
    if (legacy) window.history.replaceState(null, '', legacy);
    return parseRoute(window.location.pathname);
  });
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', on);
    window.addEventListener(EVENT, on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener(EVENT, on);
    };
  }, []);
  return route;
}

/**
 * Turns clicks on same-app links into in-page navigation. Left clicks only, without modifier keys, on links without a
 * `target` or `download`, to this origin and outside `/api` (reports and evidence files are real downloads).
 */
export function useLinkNavigation(): void {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith('/api/')) return;
      e.preventDefault();
      navigate(url.pathname + url.search);
      window.scrollTo({ top: 0 });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
}
