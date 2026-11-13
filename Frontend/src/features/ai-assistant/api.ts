/**
 * Requests of the AI assistant feature. Everything the AI produces is a proposal: drafts wait for approval in the
 * case editor and proposed test cases are previewed before they are added. Nothing AI writes runs by itself.
 */
import { get, send } from '../../shared/api/http.js';

/** A background job writing draft steps with AI. */
export interface DraftJob {
  id: string;
  status: 'running' | 'done' | 'cancelled' | 'failed';
  provider: string;
  model: string;
  total: number;
  done: number;
  startedAt: string;
  endedAt?: string;
  results: {
    caseId: string;
    outcome: 'drafted' | 'needs-fixing' | 'unmappable' | 'failed' | 'skipped';
    message?: string;
  }[];
  stoppedBecause?: string;
}

/** A test case AI suggested from a prompt, not yet added. */
export interface ProposedCase {
  title: string;
  module?: string;
  priority?: 'High' | 'Medium' | 'Low';
  preconditions?: string;
  steps: string[];
  expectedResult: string;
}

/** AI's explanation of why a case failed. */
export interface Diagnosis {
  verdict: 'test-fix' | 'likely-defect' | 'unclear';
  explanation: string;
  draft?: { version: number; status: string; issues: string[] };
}

/** Whether AI is configured and usable. */
export interface AiStatus {
  provider: 'none' | 'anthropic' | 'gemini';
  ready: boolean;
  reason?: string;
}

/** What read-only exploration found on one page. */
export interface ExploreResult {
  path: string;
  ok: boolean;
  title?: string;
  error?: string;
  chars?: number;
}

/** The most cases one drafting job accepts. */
export const MAX_DRAFTS = 25;

/** Read whether AI is configured. */
export const fetchAiStatus = () => get<AiStatus>('/api/ai');

/** Drafting jobs, running and finished. */
export async function fetchDraftJobs(): Promise<DraftJob[]> {
  const r = await get<{ items?: DraftJob[] }>('/api/ai/jobs');
  return Array.isArray(r?.items) ? r.items : [];
}

/** Start drafting steps for these cases. Drafts always wait for a person to approve them. */
export const startDrafts = (caseIds: string[]) => send<DraftJob>('/api/ai/generate', { caseIds });

/** Stop a drafting job. */
export const cancelDrafts = (id: string) =>
  send<void>(`/api/ai/jobs/${encodeURIComponent(id)}`, undefined, 'DELETE');

/** A saved skill: instructions the AI follows when a prompt calls it with `/name`. */
export interface Skill {
  name: string;
  description: string;
  instructions: string;
  updatedAt?: string;
}

/** Which skills a prompt called: applied ones, and `/words` that match no saved skill (read as plain text). */
export interface SkillUsage {
  applied: string[];
  unknown: string[];
}

const NO_SKILLS: SkillUsage = { applied: [], unknown: [] };

/** Saved skills, by name. */
export async function fetchSkills(): Promise<Skill[]> {
  const r = await get<{ items?: Skill[] }>('/api/ai/skills');
  return Array.isArray(r?.items) ? r.items : [];
}

/** Create or replace the skill called `skill.name`. */
export const saveSkill = ({ name, description, instructions }: Skill) =>
  send<Skill>(`/api/ai/skills/${encodeURIComponent(name)}`, { description, instructions }, 'PUT');

/** Delete a saved skill. */
export const deleteSkill = (name: string) =>
  send<void>(`/api/ai/skills/${encodeURIComponent(name)}`, undefined, 'DELETE');

/** Proposed cases and the skills the prompt called. */
export interface ProposeResult {
  cases: ProposedCase[];
  skills: SkillUsage;
}

/**
 * Ask the AI for test cases. `projectId` lets it use that project's page names in the steps; `/skill-name` in the
 * prompt applies a saved skill. Nothing is saved.
 */
export async function proposeCases(prompt: string, projectId?: number): Promise<ProposeResult> {
  const r = await send<{ cases?: ProposedCase[]; skills?: SkillUsage }>('/api/ai/cases/preview', {
    prompt,
    ...(projectId ? { projectId } : {}),
  });
  return { cases: Array.isArray(r?.cases) ? r.cases : [], skills: r?.skills ?? NO_SKILLS };
}

/** Optional tuning of a generation request (used by voice). Leaving it out keeps the standard behaviour. */
export interface ProposeOptions {
  coverage?: 'smoke' | 'standard' | 'thorough';
  format?: 'steps' | 'gherkin';
  /** The description is a speech transcript. */
  spoken?: boolean;
}

/** A question the AI needs answered before it can write good cases. */
export interface ClarifyingQuestion {
  question: string;
  options: string[];
}

/** What a generation round produced: cases to review, or questions to answer first, and the skills it applied. */
export type ProposeOutcome = (
  | { kind: 'cases'; cases: ProposedCase[] }
  | { kind: 'questions'; questions: ClarifyingQuestion[] }
) & { skills?: SkillUsage };

/**
 * Ask for test cases, letting the AI ask up to two clarifying questions first when the description leaves out
 * something that changes the cases. With `askFirst: false` it always writes cases. Nothing is saved.
 */
export async function proposeOrAsk(
  prompt: string,
  projectId: number | undefined,
  options: ProposeOptions & { askFirst: boolean },
): Promise<ProposeOutcome> {
  const { askFirst, ...tuning } = options;
  const body = { prompt, ...(projectId ? { projectId } : {}), options: tuning };
  if (askFirst) return send<ProposeOutcome>('/api/ai/cases/ask', body);
  const r = await send<{ cases?: ProposedCase[]; skills?: SkillUsage }>(
    '/api/ai/cases/preview',
    body,
  );
  return {
    kind: 'cases',
    cases: Array.isArray(r?.cases) ? r.cases : [],
    skills: r?.skills ?? NO_SKILLS,
  };
}

/** Add proposed cases to the inventory. */
export async function addProposedCases(
  cases: ProposedCase[],
  target: { projectId?: number; testSuiteId?: number; projectVersionId?: number } = {},
): Promise<{ id: string; title: string }[]> {
  const r = await send<{ items?: { id: string; title: string }[] }>('/api/ai/cases', {
    cases,
    ...target,
  });
  return Array.isArray(r?.items) ? r.items : [];
}

/** Ask AI why a case failed in a run. */
export const explainFailure = (runId: string, caseId: string, account?: string) =>
  send<Diagnosis>('/api/ai/diagnose', { runId, caseId, ...(account && { account }) });

/** Paths offered for exploration by default, and the limit. */
export const fetchExploreDefaults = () =>
  get<{ defaultPaths: string[]; max: number }>('/api/ai/explore');

/** Read pages of the application without changing anything. */
export async function explore(paths: string[]): Promise<ExploreResult[]> {
  const r = await send<{ items?: ExploreResult[] }>('/api/ai/explore', { paths });
  return Array.isArray(r?.items) ? r.items : [];
}
