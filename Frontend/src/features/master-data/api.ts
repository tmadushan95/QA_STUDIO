/**
 * Requests of the Projects & Versions (master data) feature: projects, where each one runs and how it signs in, its test accounts, and the
 * test suites under it. Every test case is filed under one suite, so these lists are how test cases are categorised.
 * Passwords are write-only: the server never sends them back.
 */
import { get, send, seg } from '../../shared/api/http.js';
import type { SettingsValues } from '../settings/api.js';

/** A product or application under test. */
export interface Project {
  id: number;
  code: string;
  name: string;
  description?: string;
  isActive: boolean;
  suiteCount: number;
  testCaseCount: number;
  /** Sent back on save, so an edit based on stale data is refused instead of overwriting someone else's. */
  rowVersion: string;
}

/** A group of related test cases inside a project. */
export interface TestSuite {
  id: number;
  projectId: number;
  projectName: string;
  name: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  testCaseCount: number;
  rowVersion: string;
}

/** What the project form sends. */
export interface ProjectInput {
  code: string;
  name: string;
  description?: string;
  isActive?: boolean;
  rowVersion?: string;
}

/** What the suite form sends. */
export interface TestSuiteInput {
  projectId: number;
  name: string;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
  rowVersion?: string;
}

/** What a project's connection form sends: where the application runs and how runs sign in. */
export type ConnectionInput = Pick<SettingsValues, 'envName' | 'appUrl' | 'login'>;

/** A project's saved connection. A project that has never been set up has none. */
export interface ProjectConnection extends ConnectionInput {
  projectId: number;
  /** False when it no longer passes the rules, with `reason` saying why. */
  ready: boolean;
  reason?: string;
}

/** Where a new project starts. */
export const NEW_CONNECTION: ConnectionInput = {
  envName: '',
  appUrl: '',
  login: { strategy: 'login-form', path: '/login', signedInMarker: '' },
};

/** A test account as shown. Passwords are write-only and never come back. */
export interface Account {
  id: string;
  projectId: number;
  label: string;
  username: string;
  hasPassword: boolean;
  sessionSavedAt?: string;
}

/** What is done and what is missing before a project can run. */
export function setupOf(
  connection: ProjectConnection | undefined,
  accountCount: number,
): { application: boolean; accounts: boolean; ready: boolean } {
  const application = connection?.ready === true;
  const accounts = connection?.login.strategy === 'none' || accountCount > 0;
  return { application, accounts, ready: application && accounts };
}

/** Every saved connection, and the environments that may be tested. */
export const fetchConnections = () =>
  get<{ items: ProjectConnection[]; allowedEnvs: string[] }>('/api/project-connections');

/** Check a connection without saving it. Wrong fields come back as per-field errors. */
export const checkConnection = (c: ConnectionInput) =>
  send<void>('/api/project-connections/check', c);

/** Save a project's connection. Wrong fields come back as per-field errors. */
export const saveConnection = (projectId: number, c: ConnectionInput) =>
  send<ProjectConnection>(`/api/project-connections/${projectId}`, c, 'PUT');

/** Every test account. */
export async function fetchAccounts(): Promise<Account[]> {
  const r = await get<{ items?: Account[] }>('/api/accounts');
  return Array.isArray(r?.items) ? r.items : [];
}
/** Add a test account to a project. */
export const createAccount = (a: {
  projectId: number;
  label: string;
  username: string;
  password: string;
}) => send<Account>('/api/accounts', a);
/** Change a test account. A password left out stays as it is. */
export const updateAccount = (
  id: string,
  a: { label?: string; username?: string; password?: string },
) => send<Account>(`/api/accounts/${seg(id)}`, a, 'PUT');
/** Remove a test account. */
export const deleteAccount = (id: string) =>
  send<void>(`/api/accounts/${seg(id)}`, undefined, 'DELETE');
/** Try signing in as a test account, on its project's application. */
export const testAccount = (id: string) =>
  send<{ ok: boolean; message: string }>(`/api/accounts/${seg(id)}/test`);
/** Sign in by hand in a visible window and keep the session, for SSO with a second factor. */
export const captureSession = (id: string) => send<Account>(`/api/accounts/${seg(id)}/session`);

/** Every project, by name. */
export async function fetchProjects(): Promise<Project[]> {
  const r = await get<{ items?: Project[] }>('/api/projects');
  return Array.isArray(r?.items) ? r.items : [];
}

/** Every test suite, in display order. */
export async function fetchSuites(): Promise<TestSuite[]> {
  const r = await get<{ items?: TestSuite[] }>('/api/test-suites');
  return Array.isArray(r?.items) ? r.items : [];
}

/** Add a project. */
export const createProject = (p: ProjectInput) => send<Project>('/api/projects', p);

/** Save a project. The server refuses (409) if someone else saved since `rowVersion`. */
export const updateProject = (id: number, p: ProjectInput) =>
  send<Project>(`/api/projects/${id}`, p, 'PUT');

/** Delete a project. The server refuses (409) while it still has suites. */
export const deleteProject = (id: number) => send<void>(`/api/projects/${id}`, undefined, 'DELETE');

/** Add a test suite. */
export const createSuite = (s: TestSuiteInput) => send<TestSuite>('/api/test-suites', s);

/** Save a test suite. The server refuses (409) if someone else saved since `rowVersion`. */
export const updateSuite = (id: number, s: Omit<TestSuiteInput, 'projectId'>) =>
  send<TestSuite>(`/api/test-suites/${id}`, s, 'PUT');

/** Delete a test suite. The server refuses (409) while it still holds test cases. */
export const deleteSuite = (id: number) =>
  send<void>(`/api/test-suites/${id}`, undefined, 'DELETE');

/** A release of a project, such as "2.4". Test cases can be generated, filed and run per version. */
export interface ProjectVersion {
  id: number;
  projectId: number;
  projectName: string;
  name: string;
  description?: string;
  /** yyyy-MM-dd */
  releaseDate?: string;
  /** New test cases of the project are filed under the current version by default. */
  isCurrent: boolean;
  isActive: boolean;
  testCaseCount: number;
  rowVersion: string;
}

/** What the version form sends. */
export interface ProjectVersionInput {
  name: string;
  description?: string;
  releaseDate?: string;
  isCurrent?: boolean;
  isActive?: boolean;
  rowVersion?: string;
}

/** Every version, or one project's, newest release first within each project. */
export async function fetchVersions(projectId?: number): Promise<ProjectVersion[]> {
  const r = await get<{ items?: ProjectVersion[] }>(
    `/api/project-versions${projectId ? `?projectId=${projectId}` : ''}`,
  );
  return Array.isArray(r?.items) ? r.items : [];
}

/** Add a version to a project. */
export const createVersion = (projectId: number, v: ProjectVersionInput) =>
  send<ProjectVersion>('/api/project-versions', { ...v, projectId });

/** Change a version; send the `rowVersion` it was opened with, so a stale save is refused. */
export const updateVersion = (id: number, v: ProjectVersionInput) =>
  send<ProjectVersion>(`/api/project-versions/${id}`, v, 'PUT');

/** Delete a version. Its test cases are kept, with no version. */
export const deleteVersion = (id: number) =>
  send<void>(`/api/project-versions/${id}`, undefined, 'DELETE');
