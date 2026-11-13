// @vitest-environment jsdom
/**
 * Voice in the browser: reading the screen like a screen reader, acting on it like a person, and the safety rules the
 * browser enforces whatever the model asks (dangerous clicks need confirmation; secrets are never typed by voice).
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { runCommand } from './commands.js';
import { registerVoiceAction } from './registry.js';
import { collectElements, findTarget } from './screen.js';

afterEach(cleanup);

const host = { onEnd: () => undefined };

function Form() {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('Low');
  const [ready, setReady] = useState(false);
  const [deleted, setDeleted] = useState(false);
  return (
    <main>
      <h1>Test Case Studio</h1>
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label htmlFor="pw">Password</label>
      <input id="pw" type="password" defaultValue="" />
      <label>
        Priority
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option>Low</option>
          <option>High</option>
        </select>
      </label>
      <label>
        <input type="checkbox" checked={ready} onChange={(e) => setReady(e.target.checked)} />
        Ready to run
      </label>
      <button type="button" data-danger="true" onClick={() => setDeleted(true)}>
        Remove case
      </button>
      <button type="button">Save</button>
      <button type="button">Save as draft</button>
      <p role="status">
        {title && `Title is ${title}.`} {priority} {ready ? 'ready' : 'not ready'}{' '}
        {deleted && 'deleted'}
      </p>
      <span data-voice-ui>
        <button type="button">End voice session</button>
      </span>
    </main>
  );
}

describe('reading the screen', () => {
  it('lists controls by role and accessible name, marking danger and secret fields', () => {
    render(<Form />);
    const { elements } = collectElements();
    const byName = (n: string) => elements.find((e) => e.name === n);
    expect(byName('Title')).toMatchObject({ role: 'textbox', value: '' });
    expect(byName('Password')).toMatchObject({ role: 'textbox', manualOnly: true });
    expect(byName('Password')?.value).toBeUndefined();
    expect(byName('Priority')).toMatchObject({
      role: 'combobox',
      value: 'Low',
      options: ['Low', 'High'],
    });
    expect(byName('Ready to run')).toMatchObject({ role: 'checkbox', checked: false });
    expect(byName('Remove case')).toMatchObject({ role: 'button', danger: true });
    // The voice controls are never targets.
    expect(byName('End voice session')).toBeUndefined();
  });

  it('refuses to guess between two equally good matches', () => {
    render(<Form />);
    expect(findTarget('Save')).toMatchObject({ item: { name: 'Save' } });
    const found = findTarget('sav');
    expect('error' in found && found.error).toMatch(/More than one control matches/);
  });

  it('only looks inside an open popup, as a mouse would', () => {
    render(
      <>
        <button type="button">Behind the popup</button>
        <div role="dialog" aria-modal="true" aria-label="Edit case">
          <button type="button">Inside</button>
        </div>
      </>,
    );
    expect(collectElements().elements.map((e) => e.name)).toEqual(['Inside']);
  });
});

describe('carrying out commands', () => {
  it('types, chooses and ticks through React so the app sees real input', async () => {
    render(<Form />);
    expect(
      (await runCommand({ kind: 'fill', target: 'Title', value: 'Reset password' }, host)).ok,
    ).toBe(true);
    await runCommand({ kind: 'select', target: 'Priority', option: 'high' }, host);
    await runCommand({ kind: 'check', target: 'Ready to run', checked: true }, host);
    expect(screen.getByRole('status')).toHaveTextContent('Title is Reset password. High ready');
  });

  it('asks for confirmation before a dangerous click, and clicks once confirmed', async () => {
    render(<Form />);
    const first = await runCommand({ kind: 'click', target: 'Remove case' }, host);
    expect(first.ok).toBe(false);
    expect(first.needsConfirmation).toContain('Remove case');
    expect(screen.getByRole('status')).not.toHaveTextContent('deleted');
    const second = await runCommand(
      { kind: 'click', target: 'Remove case', confirmed: true },
      host,
    );
    expect(second.ok).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent('deleted');
  });

  it('never types into password, key or type-to-confirm boxes', async () => {
    render(
      <>
        <Form />
        <label>
          Type CLEAR to confirm
          <input data-voice-manual="true" defaultValue="" />
        </label>
        <label>
          API key
          <input defaultValue="" />
        </label>
      </>,
    );
    for (const target of ['Password', 'Type CLEAR to confirm', 'API key']) {
      const r = await runCommand({ kind: 'fill', target, value: 'x' }, host);
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/user has to type it/);
    }
  });

  it('runs an app action a page offers, and says so when none matches', async () => {
    render(<Form />);
    const off = registerVoiceAction({
      name: 'cases.generate',
      description: 'Generate test cases.',
      run: async (args) => ({ message: `Generating for ${String(args['description'])}.` }),
    });
    const r = await runCommand(
      { kind: 'action', name: 'cases.generate', args: { description: 'reset' } },
      host,
    );
    expect(r).toMatchObject({ ok: true, message: 'Generating for reset.' });
    expect(r.screen?.actions.map((a) => a.name)).toContain('cases.generate');
    off();
    const gone = await runCommand({ kind: 'action', name: 'cases.generate' }, host);
    expect(gone.ok).toBe(false);
  });

  it('reports a missing control plainly instead of throwing', async () => {
    render(<Form />);
    const r = await runCommand({ kind: 'click', target: 'Ship it' }, host);
    expect(r).toMatchObject({
      ok: false,
      message: 'There is nothing called "Ship it" on this screen.',
    });
  });
});
