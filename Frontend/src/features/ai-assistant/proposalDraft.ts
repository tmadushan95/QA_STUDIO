/**
 * Unsaved AI proposals, kept while a person moves around the app.
 *
 * Generating cases costs a model call and the person's time, so leaving the Generate tab or the page must not throw the
 * results away, and asking "Discard?" on every move would only make them choose between losing work and staying put.
 * Instead the prompt and the proposals are kept in sessionStorage and come back when the panel opens again:
 * - per browser tab (sessionStorage), so two tabs never overwrite each other and a closed tab leaves nothing behind;
 * - per project, so proposals are never offered for saving into a project they were not written for;
 * - a reload keeps them too. Closing the browser tab is the one way to lose them, and the panel asks before that.
 *
 * It is a convenience, never data: unreadable or blocked storage simply means the panel starts empty, as before.
 */
import type { ProposeOptions, ProposedCase, SkillUsage } from './api.js';

/** What the panel needs to show the proposals exactly as they were left. */
export interface ProposalDraft {
  prompt: string;
  proposals: ProposedCase[];
  /** Indexes of the proposals that were ticked. */
  chosen: number[];
  usage?: SkillUsage | undefined;
  coverage?: ProposeOptions['coverage'];
}

const keyOf = (projectId: number | undefined) => `qa-studio.ai-proposals.${projectId ?? 'none'}`;

const isText = (v: unknown): v is string => typeof v === 'string';

/** Keeps only proposals that still have the shape the panel renders, so an old or edited entry cannot break it. */
function isProposal(v: unknown): v is ProposedCase {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<Record<keyof ProposedCase, unknown>>;
  return (
    isText(p.title) &&
    isText(p.expectedResult) &&
    Array.isArray(p.steps) &&
    p.steps.every(isText) &&
    (p.category === undefined || isText(p.category))
  );
}

const isTextList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText);

function isUsage(v: unknown): v is SkillUsage {
  if (!v || typeof v !== 'object') return false;
  const u = v as Partial<Record<keyof SkillUsage, unknown>>;
  return isTextList(u.applied) && isTextList(u.unknown);
}

const isIndexBelow =
  (length: number) =>
  (i: unknown): i is number =>
    typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < length;

/** The draft kept for this project in this browser tab, or undefined when there is none or it cannot be read. */
export function readDraft(projectId: number | undefined): ProposalDraft | undefined {
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(keyOf(projectId)) ?? 'null') as Partial<
      Record<keyof ProposalDraft, unknown>
    > | null;
    if (!raw) return undefined;
    const proposals = Array.isArray(raw.proposals) ? raw.proposals.filter(isProposal) : [];
    const prompt = isText(raw.prompt) ? raw.prompt : '';
    if (proposals.length === 0 && !prompt) return undefined;
    const chosen = Array.isArray(raw.chosen)
      ? raw.chosen.filter(isIndexBelow(proposals.length))
      : [];
    const coverage =
      raw.coverage === 'smoke' || raw.coverage === 'standard' || raw.coverage === 'thorough'
        ? raw.coverage
        : undefined;
    return {
      prompt,
      proposals,
      chosen,
      ...(isUsage(raw.usage) && { usage: raw.usage }),
      ...(coverage && { coverage }),
    };
  } catch {
    return undefined;
  }
}

/** Keep the draft, or forget it once there is nothing left to lose (no prompt and no proposals). */
export function writeDraft(projectId: number | undefined, draft: ProposalDraft): void {
  try {
    const key = keyOf(projectId);
    if (draft.proposals.length === 0 && !draft.prompt.trim()) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Storage blocked or full: the proposals last as long as the panel stays open, as before.
  }
}
