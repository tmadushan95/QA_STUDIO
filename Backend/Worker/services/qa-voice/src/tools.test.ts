import { describe, expect, it } from 'vitest';
import type { llm } from '@livekit/agents';
import type { ScreenSnapshot, VoiceCommand, VoiceCommandResult } from '@qa-studio/shared';
import { applyLiveKitEnv, parseMetadata } from './config.js';
import { instructions } from './instructions.js';
import { buildTools, describeScreen, toolAnswer } from './tools.js';

const screen: ScreenSnapshot = {
  title: 'Test Case Studio · Customer Portal · QA Studio',
  page: 'design',
  project: 'CP',
  headings: ['Test Case Studio'],
  messages: ['Saved.'],
  elements: [
    { ref: 'b1', role: 'button', name: 'New test case' },
    { ref: 'b2', role: 'button', name: 'Delete', danger: true },
    { ref: 'f1', role: 'textbox', name: 'Password', manualOnly: true },
    { ref: 's1', role: 'combobox', name: 'Priority', value: 'High', options: ['High', 'Low'] },
  ],
  truncated: true,
  actions: [{ name: 'cases.generate', description: 'Generate test cases' }],
};

// Tools run inside an agent session; these tests only need the arguments, not a real run context.
const opts = {} as llm.ToolOptions<unknown>;

function harness(reply: Partial<VoiceCommandResult> = {}) {
  const sent: VoiceCommand[] = [];
  let ended = false;
  const tools = buildTools(
    async (c) => {
      sent.push(c);
      return { ok: true, message: 'Done.', screen, ...reply };
    },
    () => {
      ended = true;
    },
  );
  return { tools, sent, ended: () => ended };
}

describe('voice tools', () => {
  it('describes the screen with refs, states and safety marks the model can act on', () => {
    const text = describeScreen(screen);
    expect(text).toContain('b2 button "Delete" [DANGER]');
    expect(text).toContain('f1 textbox "Password" [USER-MUST-TYPE]');
    expect(text).toContain('value="High" options=High/Low');
    expect(text).toContain('APP ACTIONS: cases.generate');
    expect(text).toContain('more elements not listed');
  });

  it('turns each tool call into exactly one browser command', async () => {
    const { tools, sent } = harness();
    await tools.click.execute({ target: 'b1' }, opts);
    await tools.type_text.execute({ target: 'Title', value: 'Reset password' }, opts);
    await tools.open_page.execute({ page: 'runs' }, opts);
    await tools.app_action.execute({ name: 'cases.generate', args: { description: 'x' } }, opts);
    expect(sent).toEqual([
      { kind: 'click', target: 'b1' },
      { kind: 'fill', target: 'Title', value: 'Reset password' },
      { kind: 'navigate', page: 'runs' },
      { kind: 'action', name: 'cases.generate', args: { description: 'x' } },
    ]);
  });

  it('tells the model to ask before repeating a dangerous click', async () => {
    const { tools } = harness({ ok: false, needsConfirmation: 'Delete test case TC-12?' });
    const answer = await tools.click.execute({ target: 'b2' }, opts);
    expect(answer).toContain('NEEDS CONFIRMATION');
    expect(answer).toContain('Delete test case TC-12?');
  });

  it('ends the session through the browser and the worker', async () => {
    const { tools, sent, ended } = harness();
    await tools.end_conversation.execute({}, opts);
    expect(sent).toEqual([{ kind: 'end' }]);
    expect(ended()).toBe(true);
  });

  it('reports failures plainly', () => {
    expect(toolAnswer({ ok: false, message: 'No button called Ship.' })).toBe(
      'FAILED: No button called Ship.',
    );
  });
});

describe('voice agent config', () => {
  it('copies QA_LIVEKIT_* into the names the LiveKit CLI reads', () => {
    const env: NodeJS.ProcessEnv = {
      QA_LIVEKIT_URL: 'wss://x.invalid',
      QA_LIVEKIT_API_KEY: 'k',
      QA_LIVEKIT_API_SECRET: 's',
    };
    expect(applyLiveKitEnv(env).configured).toBe(true);
    expect(env['LIVEKIT_URL']).toBe('wss://x.invalid');
    expect(applyLiveKitEnv({}).configured).toBe(false);
  });

  it('needs job metadata naming the browser participant', () => {
    expect(parseMetadata('{"userIdentity":"qa-user-1"}')).toMatchObject({
      userIdentity: 'qa-user-1',
      coverage: 'standard',
    });
    expect(() => parseMetadata(undefined)).toThrow(/Start voice from QA Studio/);
  });

  it('puts the safety rules and the chosen defaults in the instructions', () => {
    const text = instructions({ coverage: 'thorough', format: 'gherkin' });
    expect(text).toContain('DANGER');
    expect(text).toContain('USER-MUST-TYPE');
    expect(text).toContain('Default coverage is thorough');
    expect(text).toContain('ONE question at a time');
  });
});
