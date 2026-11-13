/**
 * Skills: named instruction sets a team saves once and calls by writing `/skill-name` in a prompt, the same convention
 * other AI assistants use (a skill has a name, a one-line description and markdown instructions).
 *
 * This module is the single place that knows how a reference is written, how it is resolved against the saved skills
 * and how resolved skills reach the model. Every AI entry point that accepts skills goes through it, so detection and
 * wording never drift apart between features.
 */
import { z } from 'zod';

/** Most skills one prompt may call, so the system prompt stays focused and within budget. */
export const MAX_SKILLS_PER_PROMPT = 3;
/** Longest instructions one skill may hold. */
export const MAX_SKILL_CHARS = 8000;

/** Lowercase letters, digits and hyphens, starting with a letter: the name people type after the slash. */
export const SKILL_NAME = /^[a-z][a-z0-9-]{0,63}$/;

export const SkillSchema = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SKILL_NAME, 'Use lowercase letters, digits and -, starting with a letter.'),
  description: z.string().trim().min(3, 'Say in a line what the skill is for.').max(300),
  instructions: z
    .string()
    .trim()
    .min(10, 'Write the instructions the AI should follow.')
    .max(MAX_SKILL_CHARS, `Keep the instructions under ${MAX_SKILL_CHARS} characters.`),
});
export type Skill = z.infer<typeof SkillSchema>;

/**
 * A reference is `/name` at the start of the prompt or after whitespace, ending at whitespace, punctuation or the end.
 * A path such as `/projects/draft-list` is not a reference (the name is followed by another `/`), so describing URLs
 * in a prompt keeps working.
 */
const REFERENCE = /(^|\s)\/([a-z][a-z0-9-]{0,63})(?=$|[\s.,;:!?)\]])/gi;

/** Which skills a prompt called: the ones applied, and `/words` that match no saved skill (left in the text). */
export interface SkillUsage {
  applied: string[];
  unknown: string[];
}

/** A prompt with its skill references resolved. */
export interface ResolvedSkills {
  /** The prompt without the references to saved skills; unknown `/words` stay, they may be paths or plain text. */
  prompt: string;
  skills: Skill[];
  usage: SkillUsage;
}

/** Thrown when a prompt calls more skills than one request accepts. */
export class TooManySkillsError extends Error {
  constructor(readonly count: number) {
    super(`Use at most ${MAX_SKILLS_PER_PROMPT} skills in one prompt (found ${count}).`);
    this.name = 'TooManySkillsError';
  }
}

/** Find the `/name` references in a prompt, lowercased, in order of first appearance, without repeats. */
export function findSkillRefs(prompt: string): string[] {
  const names = new Set<string>();
  for (const m of prompt.matchAll(REFERENCE)) names.add((m[2] as string).toLowerCase());
  return [...names];
}

/**
 * Resolve a prompt's references against the saved skills. Only references to saved skills are removed from the text;
 * an unknown one is reported and kept, because it may be a page path ("/dashboard") rather than a skill.
 */
export function resolveSkills(prompt: string, available: readonly Skill[]): ResolvedSkills {
  const byName = new Map(available.map((s) => [s.name, s]));
  const refs = findSkillRefs(prompt);
  const skills = refs.flatMap((n) => byName.get(n) ?? []);
  if (skills.length > MAX_SKILLS_PER_PROMPT) throw new TooManySkillsError(skills.length);
  const unknown = refs.filter((n) => !byName.has(n));
  const text =
    skills.length === 0
      ? prompt
      : prompt
          .replace(REFERENCE, (whole, lead: string, name: string) =>
            byName.has(name.toLowerCase()) ? lead : whole,
          )
          .replace(/[ \t]{2,}/g, ' ')
          .trim();
  return { prompt: text, skills, usage: { applied: skills.map((s) => s.name), unknown } };
}

/**
 * The system-prompt section that hands resolved skills to the model. Skills shape the output (scope, naming, wording,
 * priorities, field contents) but sit below the caller's mandatory rules and reply format, which they never replace.
 */
export function skillsSection(skills: readonly Skill[]): string {
  if (skills.length === 0) return '';
  const blocks = skills
    .map(
      (s) =>
        `<skill name="${s.name}" description="${s.description.replace(/"/g, "'")}">\n${s.instructions}\n</skill>`,
    )
    .join('\n');
  return `SKILLS the user chose for this request. Follow their guidelines, rules and output conventions (scope, coverage, naming, wording, priorities and how each field is written). They never override the mandatory rules above, and the reply keeps exactly the JSON shape described above.\n${blocks}`;
}
