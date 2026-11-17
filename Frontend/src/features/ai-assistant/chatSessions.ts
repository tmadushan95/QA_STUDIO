/**
 * AI chat sessions: each conversation of the test case generator, kept so people can leave, come back, and switch
 * between them, as in a chat app.
 *
 * - Stored in localStorage, per project, so sessions survive a closed tab or browser and are never offered for saving
 *   into a project they were not written for. They are per browser: a convenience, never shared data.
 * - The session open in a browser tab is remembered per tab (sessionStorage), so two tabs can work in two sessions and
 *   a reload reopens the same one.
 * - Only the newest `MAX_SESSIONS` are kept, so storage never grows without bound.
 * - Every read validates the shape, so an old or hand-edited entry is dropped instead of breaking the panel; blocked or
 *   full storage simply means sessions last as long as the page stays open.
 */
import type { ProposeOptions, ProposedCase, SkillUsage } from './api.js';

/** One request in the conversation: what was asked and, once a later request replaced its result, what it gave. */
export interface ChatTurn {
  prompt: string;
  note?: string | undefined;
  /** Names of the files attached to the request; their content is never stored. */
  files?: string[] | undefined;
}

/** A case saved from a session, as its result card shows it. */
export interface SavedCase {
  id: string;
  title: string;
}

/** Everything needed to show a session exactly as it was left. */
export interface ChatSession {
  id: string;
  /** Shown in the sessions list; the first request until renamed. */
  title: string;
  /** Epoch milliseconds of the last change, for ordering and grouping the list. */
  updatedAt: number;
  /** Text typed in the prompt box but not sent yet. */
  prompt: string;
  turns: ChatTurn[];
  proposals: ProposedCase[];
  /** Indexes of the proposals that are ticked. */
  chosen: number[];
  usage?: SkillUsage | undefined;
  coverage?: ProposeOptions['coverage'];
  saved?: SavedCase[] | undefined;
  /** The step-writing job started for the saved cases, so its progress shows again on return. */
  jobId?: string | undefined;
}

/** The most sessions kept per project; the least recently used go first. */
export const MAX_SESSIONS = 30;
/** Longest title taken from a first request. */
const TITLE_LENGTH = 60;

const keyOf = (projectId: number | undefined) => `qa-studio.ai-sessions.${projectId ?? 'none'}`;
const activeKeyOf = (projectId: number | undefined) =>
  `qa-studio.ai-session-active.${projectId ?? 'none'}`;

const isText = (v: unknown): v is string => typeof v === 'string';
const isTextList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText);
type Loose<T> = Partial<Record<keyof T, unknown>>;

/** Keeps only proposals that still have the shape the panel renders. */
function isProposal(v: unknown): v is ProposedCase {
  if (!v || typeof v !== 'object') return false;
  const p = v as Loose<ProposedCase>;
  return (
    isText(p.title) &&
    isText(p.expectedResult) &&
    isTextList(p.steps) &&
    (p.category === undefined || isText(p.category))
  );
}
function isUsage(v: unknown): v is SkillUsage {
  if (!v || typeof v !== 'object') return false;
  const u = v as Loose<SkillUsage>;
  return isTextList(u.applied) && isTextList(u.unknown);
}
function isTurn(v: unknown): v is ChatTurn {
  if (!v || typeof v !== 'object') return false;
  const t = v as Loose<ChatTurn>;
  return (
    isText(t.prompt) &&
    (t.note === undefined || isText(t.note)) &&
    (t.files === undefined || isTextList(t.files))
  );
}
function isSaved(v: unknown): v is SavedCase {
  if (!v || typeof v !== 'object') return false;
  const s = v as Loose<SavedCase>;
  return isText(s.id) && isText(s.title);
}
const isCoverage = (v: unknown): v is ProposeOptions['coverage'] =>
  v === 'smoke' || v === 'standard' || v === 'thorough';

/** A stored entry as a session, or undefined when it is not one. */
function toSession(v: unknown): ChatSession | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const raw = v as Loose<ChatSession>;
  if (!isText(raw.id) || !isText(raw.title) || typeof raw.updatedAt !== 'number') return undefined;
  const proposals = Array.isArray(raw.proposals) ? raw.proposals.filter(isProposal) : [];
  const chosen = Array.isArray(raw.chosen)
    ? raw.chosen.filter(
        (i): i is number =>
          typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < proposals.length,
      )
    : [];
  const saved = Array.isArray(raw.saved) ? raw.saved.filter(isSaved) : [];
  return {
    id: raw.id,
    title: raw.title,
    updatedAt: raw.updatedAt,
    prompt: isText(raw.prompt) ? raw.prompt : '',
    turns: Array.isArray(raw.turns) ? raw.turns.filter(isTurn) : [],
    proposals,
    chosen,
    ...(isUsage(raw.usage) && { usage: raw.usage }),
    ...(isCoverage(raw.coverage) && { coverage: raw.coverage }),
    ...(saved.length > 0 && { saved }),
    ...(isText(raw.jobId) && { jobId: raw.jobId }),
  };
}

/** Whether a session holds anything worth keeping; an untouched new chat is not stored. */
export const hasContent = (s: ChatSession) =>
  s.turns.length > 0 || s.proposals.length > 0 || s.prompt.trim().length > 0;

/** A title from the first request: its first line, cut at a word near `TITLE_LENGTH`. */
export function titleFrom(prompt: string): string {
  const line = prompt.trim().split('\n')[0]!.trim();
  if (line.length <= TITLE_LENGTH) return line || 'New chat';
  const cut = line.slice(0, TITLE_LENGTH);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40))}…`;
}

/** A new, empty session (not stored until it has content). */
export function newSession(): ChatSession {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    title: 'New chat',
    updatedAt: Date.now(),
    prompt: '',
    turns: [],
    proposals: [],
    chosen: [],
  };
}

/** The project's sessions, most recently changed first. */
export function listSessions(projectId: number | undefined): ChatSession[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(keyOf(projectId)) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map(toSession)
      .filter((s): s is ChatSession => !!s)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function writeAll(projectId: number | undefined, sessions: ChatSession[]) {
  try {
    window.localStorage.setItem(keyOf(projectId), JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch {
    // Storage blocked or full: sessions last as long as the page stays open.
  }
}

/**
 * Store a session (replacing the one with its id), or drop it when it has nothing to keep. Returns the new list, most
 * recently changed first.
 */
export function putSession(projectId: number | undefined, session: ChatSession): ChatSession[] {
  const others = listSessions(projectId).filter((s) => s.id !== session.id);
  const next = hasContent(session) ? [session, ...others] : others;
  next.sort((a, b) => b.updatedAt - a.updatedAt);
  writeAll(projectId, next);
  return next;
}

/** Change a stored session in place (for a result that arrives after its session was left). */
export function updateSession(
  projectId: number | undefined,
  id: string,
  change: (s: ChatSession) => ChatSession,
): ChatSession[] {
  const current = listSessions(projectId).find((s) => s.id === id);
  return current ? putSession(projectId, change(current)) : listSessions(projectId);
}

/** Remove a session for good. */
export function deleteSession(projectId: number | undefined, id: string): ChatSession[] {
  const next = listSessions(projectId).filter((s) => s.id !== id);
  writeAll(projectId, next);
  return next;
}

/** The session open in this browser tab, if one was. */
export function readActiveId(projectId: number | undefined): string | undefined {
  try {
    return window.sessionStorage.getItem(activeKeyOf(projectId)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Remember the session open in this browser tab. */
export function writeActiveId(projectId: number | undefined, id: string): void {
  try {
    window.sessionStorage.setItem(activeKeyOf(projectId), id);
  } catch {
    // Storage blocked: a reload starts a new chat instead.
  }
}

/** Which group of the sessions list a session falls in, by when it last changed. */
export function ageGroup(
  updatedAt: number,
  now = Date.now(),
): 'Today' | 'Previous 7 days' | 'Older' {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (updatedAt >= startOfToday) return 'Today';
  if (updatedAt >= startOfToday - 7 * 24 * 60 * 60 * 1000) return 'Previous 7 days';
  return 'Older';
}
