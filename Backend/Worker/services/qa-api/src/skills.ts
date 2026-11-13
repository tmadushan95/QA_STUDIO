/**
 * Saved AI skills (AI Assistant › Skills): instruction sets people call with `/skill-name` in a prompt.
 *
 * - Kept in one config block, written through to SQL Server like the other settings. Not secret, never sent anywhere
 *   except into the system prompt of a request that calls the skill.
 * - Detection and resolution of `/skill-name` live in `@qa-studio/agents` (`resolveSkills`); this service only stores.
 */
import { z } from 'zod';
import { SKILL_NAME, SkillSchema, type Skill } from '@qa-studio/agents';
import { HttpError } from './errors.js';

/** Config block holding every saved skill. */
export const SKILLS_KEY = 'ai-skills';
/** Most skills the app keeps. */
export const MAX_SKILLS = 50;

const StoredSkill = SkillSchema.extend({ updatedAt: z.string() });
/** A saved skill as the web app lists it. */
export type SkillView = z.infer<typeof StoredSkill>;
const Stored = z.array(StoredSkill);

/** The body of a save: the name comes from the URL. */
const SaveBody = SkillSchema.omit({ name: true });

export interface SkillServiceDeps {
  store: { loadConfig(key: string): unknown; saveConfig(key: string, value: unknown): void };
  audit(action: string, target: string, detail: string): void;
}

export class SkillService {
  constructor(private readonly d: SkillServiceDeps) {}

  /** Every saved skill, by name. An unreadable block reads as empty rather than failing every AI request. */
  list(): SkillView[] {
    const p = Stored.safeParse(this.d.store.loadConfig(SKILLS_KEY));
    return p.success ? [...p.data].sort((a, b) => a.name.localeCompare(b.name)) : [];
  }

  /** The skills as the generator needs them (without bookkeeping fields). */
  skills(): Skill[] {
    return this.list().map(({ name, description, instructions }) => ({
      name,
      description,
      instructions,
    }));
  }

  /** Create or replace the skill called `name`. */
  save(name: string, body: unknown): SkillView {
    const key = this.checkName(name);
    const parsed = SaveBody.safeParse(body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const i of parsed.error.issues) fields[i.path.join('.')] ??= i.message;
      throw new HttpError(
        400,
        'invalid-skill',
        parsed.error.issues[0]?.message ?? 'The skill is not valid.',
        fields,
      );
    }
    const all = this.list();
    const others = all.filter((s) => s.name !== key);
    if (others.length === all.length && all.length >= MAX_SKILLS) {
      throw new HttpError(
        409,
        'too-many-skills',
        `Keep at most ${MAX_SKILLS} skills. Delete one first.`,
      );
    }
    const saved: SkillView = { name: key, ...parsed.data, updatedAt: new Date().toISOString() };
    this.d.store.saveConfig(SKILLS_KEY, [...others, saved]);
    this.d.audit('ai.skills.save', key, others.length === all.length ? 'Added.' : 'Updated.');
    return saved;
  }

  /** Delete the skill called `name`. */
  remove(name: string): void {
    const key = this.checkName(name);
    const all = this.list();
    const rest = all.filter((s) => s.name !== key);
    if (rest.length === all.length) {
      throw new HttpError(404, 'unknown-skill', `There is no skill called /${key}.`);
    }
    this.d.store.saveConfig(SKILLS_KEY, rest);
    this.d.audit('ai.skills.delete', key, 'Deleted.');
  }

  private checkName(name: string): string {
    const key = name.trim().toLowerCase();
    if (!SKILL_NAME.test(key)) {
      const message = 'Use lowercase letters, digits and -, starting with a letter.';
      throw new HttpError(400, 'invalid-skill', message, { name: message });
    }
    return key;
  }
}
