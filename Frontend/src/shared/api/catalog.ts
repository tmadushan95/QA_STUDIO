/**
 * Reference data several features need: the step actions (with how the editor shows them), the page list from
 * Settings › Pages, and whether runs can start. Loaded once and shared, since it rarely changes.
 */
import { useEffect, useState } from 'react';
import { get } from './http.js';

/** What sort of value an action field takes. */
export type FieldKind = 'target' | 'text' | 'page' | 'number' | 'key' | 'choice' | 'boolean';

/** One field of a step action, as the editor draws it. */
export interface ActionField {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  options?: string[];
  help?: string;
  /** A value a new step of this action starts with. */
  default?: string | number | boolean;
}

/** Where the action menu lists an action: the standard library, a project's own steps, or application code. */
export type ActionGroup =
  | 'Navigate'
  | 'Interact'
  | 'Wait'
  | 'Check'
  | 'Remember'
  | 'Custom'
  | 'Application';

/**
 * One step action as the server describes it. The server derives `ui` for every action (application steps from their
 * parameter schema), so every step is edited as a form.
 */
export interface ActionInfo {
  name: string;
  description: string;
  destructive: boolean;
  source: string;
  /** Set for a step a project defined (Project settings › Custom steps): only that project's cases may use it. */
  projectId?: number;
  ui?: {
    label: string;
    group: ActionGroup;
    summary: string;
    fields: ActionField[];
  };
}

/** A named page of the application under test. */
export interface PageEntry {
  name: string;
  route: string;
  marker: string;
}

/** What the server can run right now, and the actions it knows. */
export interface AutomationInfo {
  runsAvailable: boolean;
  reason?: string;
  environment?: string;
  loginRequired?: boolean;
  accountCount?: number;
  workers?: number;
  scenarioCount: number;
  /** Features the running worker offers; absent from workers older than this list. */
  capabilities?: string[];
  actions: ActionInfo[];
}

/** Read run availability and the action catalog. */
export const fetchAutomation = () => get<AutomationInfo>('/api/automation');

/** The page list from Settings › Pages. */
export async function fetchPages(projectId?: number): Promise<PageEntry[]> {
  const r = await get<{ items?: PageEntry[] }>(
    `/api/pages${projectId ? `?projectId=${projectId}` : ''}`,
  );
  return Array.isArray(r?.items) ? r.items : [];
}

type Catalog = { actions: ActionInfo[]; pages: PageEntry[] };
const catalogs = new Map<number, Promise<Catalog>>();

/** Forget the cached catalogue, for example after the page list or a project's custom steps were edited. */
export const invalidateCatalog = () => {
  catalogs.clear();
};

/**
 * The steps a project's cases may use and the pages they may go to. Standard steps are for every project; custom steps
 * only for the project that defined them; pages are the project's own list over the shared one.
 */
export function useCatalog(projectId = 0): Catalog | undefined {
  const [value, setValue] = useState<Catalog>();
  useEffect(() => {
    let load = catalogs.get(projectId);
    if (!load) {
      load = Promise.all([
        fetchAutomation().then((a) => (Array.isArray(a?.actions) ? a.actions : [])),
        fetchPages(projectId || undefined).catch(() => []),
      ]).then(([actions, pages]) => ({
        actions: actions.filter((a) => a.projectId === undefined || a.projectId === projectId),
        pages,
      }));
      catalogs.set(projectId, load);
    }
    let live = true;
    load.then(
      (c) => live && setValue(c),
      () => {
        catalogs.delete(projectId);
        if (live) setValue({ actions: [], pages: [] });
      },
    );
    return () => {
      live = false;
    };
  }, [projectId]);
  return value;
}
