// @vitest-environment jsdom
/**
 * Automated accessibility checks (axe-core) on every main screen and on the case editor popup, with data on screen.
 * The parameters tab of the editor and the phone drawer are checked too.
 * jsdom has no layout, so colour contrast is checked by the token choices (see tokens.css), not here.
 */
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { cleanup, configure, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeServer } from '../test/fake-server.js';
import { App } from './App.js';

configure({ asyncUtilTimeout: 5000 });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

async function violations(root: Element) {
  const r = await axe.run(root, { rules: { 'color-contrast': { enabled: false } } });
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

const visit = (path: string) => {
  window.history.replaceState(null, '', path);
};

describe('accessibility (axe-core, no violations)', () => {
  for (const [hash, heading] of [
    ['/', 'Projects'],
    ['/project/GENERAL/dashboard', 'Dashboard'],
    ['/project/GENERAL/test-cases', 'Test Case Studio'],
    ['/project/GENERAL/test-execution', 'Test Execution'],
    ['/project/GENERAL/run-history', 'Run History'],
    ['/project/GENERAL/azure-devops', 'Azure DevOps'],
    ['/project/GENERAL/ai-assistant', 'AI Assistant'],
    ['/project/GENERAL/settings/general', 'Project settings'],
    ['/project/GENERAL/settings/versions', 'Project settings'],
    ['/project/GENERAL/settings/test-suites', 'Project settings'],
    ['/project/GENERAL/settings/parameters', 'Project settings'],
    ['/project/GENERAL/settings/sign-in-users', 'Project settings'],
    ['/settings/execution', 'Organization settings'],
    ['/settings/pages', 'Organization settings'],
    ['/settings/voice', 'Organization settings'],
  ] as const) {
    it(`${heading} page (${hash})`, async () => {
      fakeServer({
        'GET /api/azure-devops': () => ({ config: {}, hasToken: false, ready: false }),
        'GET /api/azure-devops/jobs': () => ({ items: [] }),
        'GET /api/voice': () => ({
          enabled: true,
          activation: 'wake',
          wakePhrase: 'hey_qa_studio',
          sensitivity: 0.5,
          idleTimeoutSec: 20,
          pauseWhenHidden: true,
          sounds: true,
          model: 'google/gemini-2.5-flash',
          coverage: 'standard',
          format: 'steps',
          language: 'en',
          livekitConfigured: true,
          wakePhrases: [{ id: 'hey_qa_studio', label: 'Hey QA Studio' }],
          modelSuggestions: ['google/gemini-2.5-flash'],
        }),
        'GET /api/settings': () => ({
          values: {
            envName: 'qa',
            appUrl: 'https://qa.example.com',
            browser: 'chromium',
            headless: true,
            slowMoMs: 0,
            workers: 1,
            timeoutMs: 30000,
            login: { strategy: 'none', path: '/login', signedInMarker: '' },
          },
          allowedEnvs: ['qa'],
          available: true,
          loginRequired: false,
          source: 'saved',
          paths: { database: 'd', artifacts: 'a', scenarios: 's', dashboard: null },
          runtime: { node: 'v22', platform: 'win32', frameworkVersion: '0.2.0' },
          security: { accessTokenRequired: false, listening: '127.0.0.1:4000' },
          notes: [],
        }),
      });
      visit(hash);
      const { container } = render(<App />);
      // First visits load a page's code; the dashboard's chart bundle is the largest.
      await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 50000 });
      // Let the page's data load before checking.
      await new Promise((r) => setTimeout(r, 50));
      expect(await violations(container.ownerDocument.body)).toEqual([]);
    });
  }

  it('case editor popup', async () => {
    fakeServer();
    visit('/project/GENERAL/test-execution');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'TC_1' }));
    await screen.findByDisplayValue('Delete');
    expect(await violations(document.body)).toEqual([]);
    await user.click(screen.getByRole('tab', { name: /Parameters/ }));
    await screen.findByLabelText(/^project/);
    expect(await violations(document.body)).toEqual([]);
  });

  it('phone menu drawer', async () => {
    fakeServer();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Open the menu' }));
    await screen.findByRole('complementary', { name: 'Menu' });
    expect(await violations(document.body)).toEqual([]);
  });
});
