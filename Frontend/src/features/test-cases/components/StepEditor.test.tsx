// @vitest-environment jsdom
/**
 * The step card and the parameter picker: a step reads as a sentence with its status in words, details can be hidden,
 * steps move with focus kept on the control used, and parameters are picked from a searchable list and shown as chips,
 * while the stored value stays `{{data.name}}`.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionInfo } from '../../../shared/api/catalog.js';
import type { Step, StepCheck } from '../api.js';
import { StepEditor, type TokenKind } from './StepEditor.js';

afterEach(cleanup);

const ACTIONS: ActionInfo[] = [
  {
    name: 'fill',
    description: '',
    destructive: false,
    source: 'standard',
    ui: {
      label: 'Fill a field',
      group: 'Interact',
      summary: 'fill {target} with {value}',
      fields: [
        { name: 'target', label: 'Field', kind: 'target', required: true },
        { name: 'value', label: 'Value', kind: 'text', required: true },
      ],
    },
  },
  {
    name: 'delete-row',
    description: '',
    destructive: true,
    source: 'standard',
    ui: {
      label: 'Delete a row',
      group: 'Interact',
      summary: 'delete the row containing {text}',
      fields: [{ name: 'text', label: 'Text', kind: 'text', required: true }],
    },
  },
];

const fill = (value?: string): Step => ({
  action: 'fill',
  params: { target: { label: 'Code' }, ...(value !== undefined && { value }) },
});

function setup({
  steps = [fill('PRJ-1')],
  names = ['code', 'roleName'],
  values = { code: 'ABC', roleName: '' } as Record<string, string> | undefined,
  kind = 'data' as TokenKind,
  checks = [] as StepCheck[],
} = {}) {
  const onChange = vi.fn<(s: Step[]) => void>();
  function Harness() {
    const [current, setCurrent] = useState(steps);
    return (
      <StepEditor
        steps={current}
        onChange={(s) => {
          setCurrent(s);
          onChange(s);
        }}
        actions={ACTIONS}
        pages={[]}
        dataNames={names}
        values={values}
        tokenKind={kind}
        checks={checks}
      />
    );
  }
  render(<Harness />);
  const last = () => onChange.mock.calls.at(-1)?.[0];
  return { user: userEvent.setup(), last };
}

/** The sentence at the top of a step card. */
const sentenceOf = (n: number) =>
  screen
    .getAllByRole('listitem')
    .filter((li) => li.dataset['step'] === String(n - 1))[0]!
    .querySelector('p')!;

describe('step card', () => {
  it('says what the step does, with values highlighted and a missing value said in words', () => {
    setup({ steps: [fill(), fill('{{data.code}}')] });
    expect(sentenceOf(1)).toHaveTextContent('Fill field “Code” with Value missing');
    // A parameter reads as a chip with its current value, not as {{data.code}}.
    expect(sentenceOf(2)).toHaveTextContent('Fill field “Code” with parameter code: ABC');
    expect(sentenceOf(2)).not.toHaveTextContent('{{');
  });

  it('shows problems, notes and data changes as words, also while the details are hidden', async () => {
    const { user } = setup({
      steps: [{ action: 'delete-row', params: { text: 'PRJ-1' } }],
      checks: [{ index: 0, issues: ['The row was not found.'], warnings: ['Slow page.'] }],
    });
    expect(screen.getByText('1 problem')).toBeInTheDocument();
    expect(screen.getByText('1 note')).toBeInTheDocument();
    expect(screen.getByText('Changes data')).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'Step 1 details' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Step 1: action')).not.toBeInTheDocument();
    expect(screen.getByText('The row was not found.')).toBeVisible();
  });

  it('moves a step and keeps focus on the button used, at the step’s new place', async () => {
    const { user, last } = setup({ steps: [fill('first'), fill('second')] });
    await user.click(screen.getByRole('button', { name: 'Move step 1 down' }));
    expect(last()?.map((s) => s.params['value'])).toEqual(['second', 'first']);
    // Step 2 is now the last one, so its "down" is disabled and focus goes to its details toggle.
    expect(screen.getByRole('button', { name: 'Step 2 details' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Move step 2 up' }));
    expect(last()?.map((s) => s.params['value'])).toEqual(['first', 'second']);
    expect(screen.getByRole('button', { name: 'Step 1 details' })).toHaveFocus();
  });

  it('hides and shows every step’s details at once, and focuses a new step', async () => {
    const { user } = setup({ steps: [fill('a'), fill('b')] });
    await user.click(screen.getByRole('button', { name: 'Hide all details' }));
    expect(screen.queryByLabelText('Step 1: action')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Step 2: action')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all details' }));
    expect(screen.getByLabelText('Step 2: action')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    expect(screen.getByLabelText('Step 3: action')).toHaveFocus();
  });
});

describe('parameter picker', () => {
  it('lists parameters with their values, filters as you type, and shows the pick as a chip', async () => {
    const { user, last } = setup({ steps: [fill()] });
    await user.click(screen.getByRole('button', { name: 'Use parameter in Step 1: Value' }));
    const picker = screen.getByRole('dialog', { name: 'Choose a parameter' });
    const search = within(picker).getByRole('combobox');
    expect(search).toHaveFocus();
    expect(within(picker).getByRole('option', { name: /^code\W+ABC$/ })).toBeInTheDocument();
    expect(
      within(picker).getByRole('option', { name: /^roleName\W+no value yet$/ }),
    ).toBeInTheDocument();

    await user.type(search, 'co');
    expect(within(picker).queryByRole('option', { name: /roleName/ })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');

    // Stored exactly as before; shown as a chip with a button to change it, which now has focus.
    expect(last()?.[0]?.params['value']).toBe('{{data.code}}');
    expect(screen.queryByRole('dialog', { name: 'Choose a parameter' })).not.toBeInTheDocument();
    const field = screen.getByRole('group', { name: 'Step 1: Value' });
    expect(field).toHaveTextContent('parameter code: ABC');
    expect(
      within(field).getByRole('button', { name: 'Change parameter in Step 1: Value' }),
    ).toHaveFocus();
  });

  it('inserts at the cursor and previews the parameters in mixed text', async () => {
    const { user, last } = setup({ steps: [fill('PRJ-X')] });
    const box = screen.getByLabelText('Step 1: Value');
    await user.click(box);
    act(() => (box as HTMLInputElement).setSelectionRange(4, 4));
    await user.click(screen.getByRole('button', { name: 'Use parameter in Step 1: Value' }));
    await user.click(screen.getByRole('option', { name: /^code\W+ABC$/ }));
    expect(last()?.[0]?.params['value']).toBe('PRJ-{{data.code}}X');
    expect(box).toHaveFocus();
    expect((box as HTMLInputElement).selectionStart).toBe('PRJ-{{data.code}}'.length);
    expect(screen.getByText('Reads as:').parentElement).toHaveTextContent(
      'Reads as: PRJ-parameter code: ABCX',
    );
  });

  it('creates a new parameter by name, and explains a name it cannot take', async () => {
    const { user, last } = setup({ steps: [fill()] });
    await user.click(screen.getByRole('button', { name: 'Use parameter in Step 1: Value' }));
    const search = screen.getByRole('combobox', { name: /Search/ });
    await user.type(search, '9lives');
    expect(screen.getByRole('status')).toHaveTextContent('A name starts with a letter');
    await user.clear(search);
    await user.type(search, 'projectName');
    await user.click(screen.getByRole('option', { name: /Create parameter “projectName”/ }));
    expect(last()?.[0]?.params['value']).toBe('{{data.projectName}}');
  });

  it('closes on Escape without closing anything around it, and gives focus back', async () => {
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    const { user } = setup();
    const trigger = screen.getByRole('button', { name: 'Use parameter in Step 1: Value' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    document.removeEventListener('keydown', outer);
    expect(screen.queryByRole('dialog', { name: 'Choose a parameter' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(outer).not.toHaveBeenCalled();
  });

  it('goes back to typing a value from a chip', async () => {
    const { user, last } = setup({ steps: [fill('{{data.code}}')] });
    await user.click(screen.getByRole('button', { name: 'Type a value in Step 1: Value instead' }));
    expect(last()?.[0]?.params).not.toHaveProperty('value');
    expect(screen.getByLabelText('Step 1: Value')).toHaveFocus();
  });

  it('offers a custom step’s inputs, which it never creates', async () => {
    const { user, last } = setup({
      steps: [fill()],
      names: ['role'],
      values: undefined,
      kind: 'input',
    });
    await user.click(screen.getByRole('button', { name: 'Use input in Step 1: Value' }));
    const search = screen.getByRole('combobox', { name: 'Search inputs' });
    await user.type(search, 'other');
    expect(
      within(screen.getByRole('dialog', { name: 'Choose an input' })).queryByRole('option'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No input matches “other”.');
    await user.clear(search);
    await user.click(screen.getByRole('option', { name: 'role' }));
    expect(last()?.[0]?.params['value']).toBe('{{input.role}}');
  });
});
