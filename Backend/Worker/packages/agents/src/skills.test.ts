import { describe, expect, it } from 'vitest';
import {
  TooManySkillsError,
  findSkillRefs,
  resolveSkills,
  skillsSection,
  type Skill,
} from './index.js';

const skill = (name: string): Skill => ({
  name,
  description: `About ${name}`,
  instructions: `Instructions of ${name}.`,
});

describe('skills', () => {
  it('finds /name references at word starts, case-insensitively, and ignores paths and mid-word slashes', () => {
    expect(
      findSkillRefs('/Smoke test and/or /edge, then /projects/draft-list and /smoke again'),
    ).toEqual(['smoke', 'edge']);
  });

  it('removes only saved skills from the prompt and reports the unknown ones', () => {
    const r = resolveSkills('Test login /smoke from /dashboard.', [skill('smoke')]);
    expect(r.prompt).toBe('Test login from /dashboard.');
    expect(r.skills.map((s) => s.name)).toEqual(['smoke']);
    expect(r.usage).toEqual({ applied: ['smoke'], unknown: ['dashboard'] });
  });

  it('leaves a prompt without saved skills exactly as written', () => {
    const prompt = '  Test   /dashboard  ';
    expect(resolveSkills(prompt, []).prompt).toBe(prompt);
  });

  it('refuses more skills than one prompt may call', () => {
    const all = ['a', 'b', 'c', 'd'].map(skill);
    expect(() => resolveSkills('/a /b /c /d login', all)).toThrow(TooManySkillsError);
  });

  it('builds no section without skills, and one block per skill otherwise', () => {
    expect(skillsSection([])).toBe('');
    const text = skillsSection([skill('smoke'), skill('edge')]);
    expect(text).toContain('never override the mandatory rules');
    expect(text.match(/<skill /g)).toHaveLength(2);
  });
});
