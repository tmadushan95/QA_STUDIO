import { describe, expect, it } from 'vitest';
import { FakeLlm, LlmGateway } from '@qa-studio/llm';
import type { TestCase } from '@qa-studio/shared';
import { diagnoseFailure, type ActionInfo, type StepDraft } from './index.js';

const actions: ActionInfo[] = [
  {
    name: 'drafts.open-project',
    description: 'Open a project.',
    params: { type: 'object', properties: { list: { type: 'string' }, code: { type: 'string' } } },
  },
  {
    name: 'assert.text-visible',
    description: 'Assert text.',
    params: { type: 'object', properties: { text: { type: 'string' } } },
  },
];
const known = new Set(actions.map((a) => a.name));
const validate = (steps: StepDraft[]) => ({
  issues: steps.flatMap((s, i) =>
    known.has(s.action) ? [] : [`Step ${i + 1}: unknown ${s.action}`],
  ),
  warnings: [],
});

const tc = {
  schemaVersion: 1,
  id: 'TC_06',
  title: 'Verify the delete confirmation message',
  steps: [{ order: 1, action: 'Click Delete' }],
  expectedResult: 'The dialog title is "Delete Project?"',
  tags: [],
  dependsOn: [],
  readiness: 'needs-clarification',
  source: { workbook: 'p.xlsx', worksheet: 'S', rowNumber: 7 },
} as TestCase;

const scenarioSteps: StepDraft[] = [
  { action: 'drafts.open-project', params: { list: 'draft', code: '{{data.draftProject}}' } },
  { action: 'assert.text-visible', params: { text: 'Confirm Delete' } },
];

const failure = {
  stepNumber: 2,
  action: 'assert.text-visible',
  kind: 'assertion',
  message: 'Expected text to be visible: "Confirm Delete"',
  expected: 'Confirm Delete',
  actual: 'not visible',
  pageSnapshot:
    'URL: https://qa/projects/1/draft\n- dialog "Delete Project?":\n  - button "Confirm"',
};

const run = (answer: string) => {
  const fake = new FakeLlm([answer]);
  return {
    fake,
    out: diagnoseFailure({
      gateway: new LlmGateway(fake),
      testCase: tc,
      scenarioSteps,
      failure,
      actions,
      validate,
    }),
  };
};

describe('diagnoseFailure', () => {
  it('proposes corrected steps when the test is out of date, checked by the validator', async () => {
    const fixed = [
      scenarioSteps[0],
      { action: 'assert.text-visible', params: { text: 'Delete Project?' } },
    ];
    const { out, fake } = run(
      JSON.stringify({
        verdict: 'test-fix',
        explanation:
          'The scenario checks an old title; the page shows "Delete Project?" as the case expects.',
        steps: fixed,
      }),
    );
    const d = await out;
    expect(d).toMatchObject({ verdict: 'test-fix', issues: [], warnings: [] });
    if (d.verdict !== 'test-fix') throw new Error('unreachable');
    expect(d.steps[1]!.params).toEqual({ text: 'Delete Project?' });
    // Everything the model needs is in the prompt, inside data tags.
    const prompt = fake.requests[0]!.messages[0]!.content;
    for (const part of [
      '<test_case>',
      '<scenario>',
      '<failure>',
      '<page>',
      'dialog "Delete Project?"',
      'expected: Confirm Delete',
    ]) {
      expect(prompt).toContain(part);
    }
    expect(fake.requests[0]!.system).toContain(
      'Never weaken or remove the check of the expected result',
    );
  });

  it('reports a likely defect without proposing any change', async () => {
    const { out } = run(
      JSON.stringify({
        verdict: 'likely-defect',
        explanation: 'The case expects "Delete Project?" but the app shows another title.',
        steps: [{ action: 'x', params: {} }],
      }),
    );
    const d = await out;
    expect(d).toEqual({
      verdict: 'likely-defect',
      explanation: 'The case expects "Delete Project?" but the app shows another title.',
    });
  });

  it('keeps invalid corrected steps visible as issues instead of hiding them', async () => {
    const { out } = run(
      JSON.stringify({
        verdict: 'test-fix',
        explanation: 'A different action is needed here.',
        steps: [{ action: 'made.up', params: {} }],
      }),
    );
    const d = await out;
    expect(d).toMatchObject({ verdict: 'test-fix', issues: ['Step 1: unknown made.up'] });
  });

  it('treats a "test-fix" with no steps as unclear', async () => {
    const { out } = run(
      JSON.stringify({ verdict: 'test-fix', explanation: 'Something about the wait time.' }),
    );
    expect((await out).verdict).toBe('unclear');
  });
});
