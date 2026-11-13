/**
 * Requests of the Test cases feature: the case list, each case's steps (scenario) with its history, live step
 * checking, and bulk actions. Everything is saved to the database.
 */
import type { TestCase as TestCaseDocument } from '@qa-studio/shared';
import { get, send, seg } from '../../shared/api/http.js';

/** A test case with where it is filed. */
export type TestCase = TestCaseDocument & {
  testSuiteId?: number;
  testSuiteName?: string;
  projectId?: number;
  projectName?: string;
  /** The project version the case was written for, when one was chosen. */
  projectVersionId?: number;
  projectVersionName?: string;
};

/** One runnable step: an action and its parameters. */
export interface Step {
  action: string;
  params: Record<string, unknown>;
}

/** A version of a case's runnable steps, with where it is in its life. */
export interface ScenarioRecord {
  caseId: string;
  scenario: { description?: string; steps: Step[] };
  status: 'draft' | 'validated' | 'approved';
  origin: 'manual' | 'ai' | 'file' | 'rules';
  version: number;
  updatedAt: string;
  approvedAt?: string;
  note?: string;
  issues: string[];
  warnings: string[];
}

/** The approved version of a case and any draft waiting beside it. */
export interface ScenarioDetail {
  approved?: ScenarioRecord;
  draft?: ScenarioRecord;
}

/** What the list shows about a case's automation. */
export interface ScenarioRow {
  caseId: string;
  state: 'approved' | 'validated' | 'draft' | 'none';
  version?: number;
  steps?: number;
  hasDraft: boolean;
}

/** Problems found in one step while editing. */
export interface StepCheck {
  index: number;
  issues: string[];
  warnings: string[];
}

/** Every test case. The list is filtered and paged in the browser, so filters can combine automation status. */
export async function fetchAllCases(): Promise<TestCase[]> {
  const all: TestCase[] = [];
  for (let page = 1; ; page++) {
    const p = await get<{ total: number; items: TestCase[] }>(
      `/api/test-cases?page=${page}&pageSize=200`,
    );
    all.push(...(p.items ?? []));
    if (all.length >= p.total || (p.items ?? []).length === 0) return all;
  }
}

/** What the list shows about every case's automation. */
export async function fetchScenarioRows(): Promise<ScenarioRow[]> {
  const r = await get<{ items?: ScenarioRow[] }>('/api/scenarios');
  return Array.isArray(r?.items) ? r.items : [];
}

/** A case's approved steps and any draft. */
export const fetchScenario = (caseId: string) =>
  get<ScenarioDetail>(`/api/scenarios/${seg(caseId)}`);

/**
 * Save a person's edit. Valid steps become the version that runs; steps with problems are kept as a draft.
 * `expectedVersion` makes the server refuse the save if someone else saved in between.
 */
export const saveSteps = (
  caseId: string,
  body: { steps: Step[]; description?: string; expectedVersion: number },
) => send<ScenarioRecord>(`/api/scenarios/${seg(caseId)}`, body, 'PUT');

/** Check steps without saving them. */
export async function checkSteps(steps: Step[]): Promise<StepCheck[]> {
  const r = await send<{ steps?: StepCheck[] }>('/api/scenarios/validate', { steps });
  return Array.isArray(r?.steps) ? r.steps : [];
}

/** Earlier approved versions of a case, newest first. */
export async function fetchHistory(caseId: string): Promise<ScenarioRecord[]> {
  const r = await get<{ items?: ScenarioRecord[] }>(`/api/scenarios/${seg(caseId)}/history`);
  return Array.isArray(r?.items) ? r.items : [];
}

/** Make an earlier version current again, as a new version. */
export const restoreVersion = (caseId: string, version: number) =>
  send<ScenarioRecord>(`/api/scenarios/${seg(caseId)}/restore/${version}`);

/** Approve a case's draft, so it can run. */
export const approveDraft = (caseId: string) =>
  send<ScenarioRecord>(`/api/scenarios/${seg(caseId)}/approve`);

/** Approve the drafts of several cases. */
export const approveMany = (caseIds: string[]) =>
  send<{ approved: number; skipped: string[] }>('/api/scenarios/approve', { caseIds });

/** Delete test cases. */
export const deleteCases = (ids: string[]) =>
  send<{ deleted: number; notFound: number }>('/api/test-cases/delete', { ids });

/** File test cases under another test suite. */
export const moveCases = (ids: string[], testSuiteId: number) =>
  send<{ moved: number; notFound: number }>('/api/test-cases/move', { ids, testSuiteId });

/** What the new test case form sends. */
export interface NewCase {
  /** Leave out to let the server take the next free ID when it creates the case. */
  id?: string;
  /** The test suite it is filed under. */
  testSuiteId: number;
  /** The project version it is written for (a version of the suite's project). */
  projectVersionId?: number;
  title: string;
  module?: string;
  priority?: string;
  steps: string[];
  expectedResult?: string;
}

/** Add a test case to a test suite. */
export const createCase = (c: NewCase) => send<TestCase>('/api/test-cases', c);

/** The ID the next new case would get, following the existing pattern (e.g. TC_31 after TC_30). */
export const fetchNextCaseId = () => get<{ id: string }>('/api/test-cases/next-id');

/** Give test cases a project version, or clear it with `null`. */
export const assignVersion = (ids: string[], projectVersionId: number | null) =>
  send<{ assigned: number; notFound: number }>('/api/test-cases/assign-version', {
    ids,
    projectVersionId,
  });

// ---- Parameters: the values a case's steps read as {{data.name}}, kept per test case ----

/** Names a parameter can have: letters, digits, - or _, starting with a letter (as `{{data.name}}` requires). */
export const PARAMETER_NAME = /^[A-Za-z][\w-]{0,99}$/;

/** The parameter names steps refer to, in first-seen order. */
export function dataNamesIn(value: unknown): string[] {
  const text = JSON.stringify(value ?? '');
  return [
    ...new Set([...text.matchAll(/\{\{\s*data\.([A-Za-z][\w-]*)\s*\}\}/g)].map((m) => m[1]!)),
  ];
}

/** Which layer a run takes a value from: the case's own, its project's common value, or none (blocked). */
export type ParameterSource = 'case' | 'common' | 'missing';

/** One parameter of a case. `used` is false for a value kept from an earlier version of the steps. */
export interface ParameterItem {
  name: string;
  /** The case's own value; empty when it uses the common value or has none. */
  value: string;
  /** The project's common value for this name, when one is set. */
  common?: string;
  source: ParameterSource;
  used: boolean;
}

/** Every parameter of one case, and the names that still have no value (the case is blocked until they do). */
export interface CaseParameters {
  caseId: string;
  /** The project whose common values the case inherits. */
  projectId?: number;
  items: ParameterItem[];
  missing: string[];
}

/** One case's need for values, for the "Parameters" column of the lists. */
export interface ParameterSummary {
  caseId: string;
  needed: number;
  missing: string[];
}

/** A value filled automatically, and where it came from. */
export interface ParameterSuggestion {
  name: string;
  value: string;
  source: 'legacy' | 'ai' | 'guess';
}

/** How many values each case needs and which are missing (cases needing none are left out). */
export async function fetchParameterSummary(): Promise<ParameterSummary[]> {
  const r = await get<{ items?: ParameterSummary[] }>('/api/parameters');
  return Array.isArray(r?.items) ? r.items : [];
}

/** One case's parameters. */
export const fetchParameters = (caseId: string) =>
  get<CaseParameters>(`/api/parameters/${seg(caseId)}`);

/** Replace one case's values; empty values are dropped. The answer is the case's parameters as saved. */
export const saveParameters = (caseId: string, values: Record<string, string>) =>
  send<CaseParameters>(`/api/parameters/${seg(caseId)}`, { values }, 'PUT');

/** Values for a case's missing parameters, without saving them. */
export async function suggestParameters(caseId: string, ai = true): Promise<ParameterSuggestion[]> {
  const r = await send<{ items?: ParameterSuggestion[] }>(
    `/api/parameters/${seg(caseId)}/suggest`,
    { ai },
  );
  return Array.isArray(r?.items) ? r.items : [];
}

/** One common value of a project, with how many of its cases use and override it. */
export interface CommonParameterItem {
  name: string;
  value: string;
  usedBy: number;
  overriddenBy: number;
}

/** A project's common values, plus names its cases read that have none yet. */
export const fetchCommonParameters = (projectId: number) =>
  get<{ projectId: number; items: CommonParameterItem[] }>(`/api/parameters/common/${projectId}`);

/** Replace a project's common values; empty values are dropped. The answer is the project's common values as saved. */
export const saveCommonParameters = (projectId: number, values: Record<string, string>) =>
  send<{ projectId: number; items: CommonParameterItem[] }>(
    `/api/parameters/common/${projectId}`,
    { values },
    'PUT',
  );

/** Values for a project's empty common names (old test data, then a guess from the name). Not saved. */
export async function suggestCommonParameters(projectId: number): Promise<ParameterSuggestion[]> {
  const r = await send<{ items?: ParameterSuggestion[] }>(
    `/api/parameters/common/${projectId}/suggest`,
  );
  return Array.isArray(r?.items) ? r.items : [];
}

/** Fill and save the missing values of many cases at once; values a person set are never changed. */
export const autoConfigure = (caseIds: string[], ai = true) =>
  send<{ configured: number; filled: number; stillMissing: ParameterSummary[] }>(
    '/api/parameters/auto',
    { caseIds, ai },
  );

/** Turn written steps into runnable steps (rule-based, as a background job). */
export const convertCases = (caseIds: string[]) =>
  send<{ id: string }>('/api/conversions', { caseIds });

/** Ask the AI for draft steps for several cases (as a background job). */
export const draftWithAi = (caseIds: string[]) =>
  send<{ id: string }>('/api/ai/generate', { caseIds });
