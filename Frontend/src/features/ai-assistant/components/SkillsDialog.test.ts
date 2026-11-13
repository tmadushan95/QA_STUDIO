import { describe, expect, it } from 'vitest';
import { parseSkillFile } from './SkillsDialog.js';

describe('parseSkillFile', () => {
  it('reads name and description from front matter and the rest as instructions', () => {
    const text =
      '---\r\nname: Login Rules\r\ndescription: "House rules for login cases"\r\nallowed-tools: x\r\n---\r\n\r\n# Rules\n- Always add a locked-account case.\n';
    expect(parseSkillFile(text, 'SKILL.md')).toEqual({
      name: 'login-rules',
      description: 'House rules for login cases',
      instructions: '# Rules\n- Always add a locked-account case.',
    });
  });

  it('uses the file name and the whole text when there is no front matter', () => {
    expect(parseSkillFile('Write High priority cases first.', 'smoke-pack.md')).toEqual({
      name: 'smoke-pack',
      description: '',
      instructions: 'Write High priority cases first.',
    });
  });
});
