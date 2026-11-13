import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type TestCase } from '@qa-studio/shared';
import { ActionRegistry } from '../registry.js';
import { registerGenericActions } from './actions.js';
import { convertTestCase } from './convert.js';

const tc = (steps: { action: string; expected?: string }[], expectedResult?: string): TestCase => ({
  schemaVersion: SCHEMA_VERSION,
  id: 'TC_1',
  title: 'T',
  steps: steps.map((s, i) => ({ order: i + 1, ...s })),
  ...(expectedResult && { expectedResult }),
  tags: [],
  dependsOn: [],
  readiness: 'needs-clarification',
  source: { workbook: 'w', worksheet: 's', rowNumber: 2 },
});

describe('rule-based conversion of written steps', () => {
  it('converts common sentences into valid generic steps and skips sign-in', () => {
    const r = convertTestCase(
      tc(
        [
          { action: 'Sign in as a user who can delete projects' },
          { action: 'Go to the Draft projects page' },
          { action: 'Enter "PRJ-1" in the Search field' },
          { action: 'Select Open from the Status dropdown' },
          { action: 'Click the Delete button', expected: 'Dialog "Delete Project?" appears' },
          { action: 'Click on Cancel link' },
          { action: 'Verify "Project deleted" is displayed' },
          { action: 'Verify Delete is not displayed' },
        ],
        'The project is removed.',
      ),
      { 'draft projects': { route: '/drafts', marker: 'Drafts' } },
    );
    expect(r.skippedSignIn).toBe(1);
    expect(r.steps).toEqual([
      { action: 'go-to-page', params: { page: 'draft projects' } },
      { action: 'fill', params: { target: { label: 'Search' }, value: 'PRJ-1' } },
      { action: 'select', params: { target: { label: 'Status' }, option: 'Open' } },
      { action: 'click', params: { target: { role: 'button', name: 'Delete' } } },
      { action: 'assert-text', params: { text: 'Delete Project?' } },
      { action: 'click', params: { target: { role: 'link', name: 'Cancel' } } },
      { action: 'assert-text', params: { text: 'Project deleted' } },
      { action: 'assert-no-text', params: { text: 'Delete' } },
    ]);
    expect(r.unmatched).toEqual(['Expected: The project is removed.']);
    // Every converted step passes the same validation a run uses.
    const registry = registerGenericActions(new ActionRegistry());
    expect(r.steps.every((s) => registry.validate(s.action, s.params).ok)).toBe(true);
  });

  it('never guesses: an unknown page or sentence is left for a person', () => {
    const r = convertTestCase(
      tc([{ action: 'Go to Reports' }, { action: 'Approve the budget twice' }]),
    );
    expect(r.steps).toEqual([]);
    expect(r.unmatched).toEqual(['Go to Reports', 'Approve the budget twice']);
  });
});
