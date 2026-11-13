// @vitest-environment jsdom
/**
 * UI tests of the main flows: project-first navigation (project list, project and version switchers), Test Case
 * Studio (create, review, mark ready), Test Execution (run, concurrent users, parameters), the step editor popup (save, conflicts, unsaved changes), the import → conversion flow,
 * Sign-in Users, Azure DevOps, project versions, the dashboard and the settings sub-menu.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, httpError, tc as tcOf } from '../test/fake-server.js';
import { App } from './App.js';

// Pages load on first visit (code splitting); the first visit in a test run can take over a second.
configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  // The work context (project and version) is remembered per browser; every test starts without one.
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const go = (path: string) => {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

/** The fake server's only project; its pages live under this address. */
const HOME = '/project/GENERAL';

const MENU = [
  'Dashboard',
  'Test Case Studio',
  'AI Assistant',
  'Test Execution',
  'Run History',
  'Azure DevOps',
  'Project settings',
];

describe('app shell', () => {
  it('starts on the project list, with nothing else to choose until a project is open', async () => {
    fakeServer();
    render(<App />);
    expect(await screen.findByRole('link', { name: 'General' })).toHaveAttribute(
      'href',
      `${HOME}/dashboard`,
    );
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Projects', 'Organization settings']);
    expect(
      screen.queryByRole('navigation', { name: 'Project and version' }),
    ).not.toBeInTheDocument();
  });

  it('switches the version for every page from the header, like a branch', async () => {
    fakeServer();
    go(`${HOME}/test-cases`);
    const user = userEvent.setup();
    render(<App />);
    const scope = await screen.findByRole('navigation', { name: 'Project and version' });
    await user.click(within(scope).getByRole('button', { name: /Switch version/ }));
    await user.click(await screen.findByRole('menuitem', { name: /1\.0/ }));
    expect(
      await within(scope).findByRole('button', { name: 'Version: 1.0. Switch version' }),
    ).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('qa-studio.work-context') ?? '{}')).toMatchObject(
      { projectId: 1, versionId: 3 },
    );
  });

  it('shows the environment and every main section as a link, in working order', async () => {
    fakeServer();
    go(`${HOME}/dashboard`);
    render(<App />);
    // The dashboard's chart bundle is the largest; its first load in a busy test run can take a while.
    expect(
      await screen.findByRole('heading', { name: 'Dashboard', level: 1 }, { timeout: 50000 }),
    ).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(MENU);
    expect(within(nav).getByRole('list', { name: 'Test design' })).toBeInTheDocument();
    expect(within(nav).getByRole('list', { name: 'Administration' })).toBeInTheDocument();
    expect(await screen.findByText('qa')).toBeInTheDocument();
  });

  it('has a bottom bar for phones and a drawer with the full menu', async () => {
    fakeServer();
    go(`${HOME}/dashboard`);
    const user = userEvent.setup();
    render(<App />);
    const quick = await screen.findByRole('navigation', { name: 'Quick' });
    await waitFor(() =>
      expect(
        within(quick)
          .getAllByRole('link')
          .map((l) => l.textContent),
      ).toEqual(['Dashboard', 'Test Case Studio', 'Test Execution', 'Run History']),
    );
    await user.click(screen.getByRole('button', { name: 'Open the menu' }));
    const drawer = screen.getByRole('complementary', { name: 'Menu' });
    expect(within(drawer).getByRole('link', { name: 'Project settings' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Menu' })).not.toBeInTheDocument();
  });

  it('opens old addresses on the page that replaced them', async () => {
    fakeServer();
    go('/test-design');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Test Case Studio', level: 1 }),
    ).toBeInTheDocument();
    // Without a project in the old address, the only (or last used) project is opened.
    expect(window.location.pathname).toBe(`${HOME}/test-cases`);
  });

  it('asks for the access token when the server requires one', async () => {
    fakeServer({ 'GET /api/auth/status': () => ({ required: true, authenticated: false }) });
    render(<App />);
    expect(await screen.findByLabelText('Access token')).toBeInTheDocument();
  });
});

describe('dashboard', () => {
  it('shows headline numbers and library counts', async () => {
    const server = fakeServer();
    go(`${HOME}/dashboard`);
    render(<App />);
    const kpis = await screen.findByRole('region', { name: 'Key numbers' });
    // Numbers are for the project in the header.
    expect(server.sent('GET', '/api/dashboard').map((c) => c.query)).toContain('?projectId=1');
    expect(within(kpis).getByText('Automated')).toBeInTheDocument();
    expect(within(kpis).getByText('50%')).toBeInTheDocument();
    expect(await within(kpis).findByText('1 project · 1 version')).toBeInTheDocument();
    expect(screen.getByText('How these numbers are calculated')).toBeInTheDocument();
  });
});

describe('test execution', () => {
  it('lists only cases that are ready, with their parameters and last result', async () => {
    fakeServer();
    go('/test-execution');
    render(<App />);
    const row = (await screen.findByRole('button', { name: 'TC_1' })).closest('tr')!;
    expect(within(row).getByText('1 missing')).toBeInTheDocument();
    expect(within(row).getByText('Not run yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'TC_2' })).not.toBeInTheDocument();
  });

  it('shows how often a case ran, its last result, and the issue behind an info icon', async () => {
    const result = (status: string, at: string, failure?: object) => ({
      caseId: 'TC_1',
      status,
      startedAt: at,
      steps: [],
      artifacts: [],
      ...(failure && { failure }),
    });
    const run = (id: string, at: string, c: object) => ({
      id,
      status: 'failed',
      createdAt: at,
      environment: 'qa',
      browser: 'chromium',
      workers: 1,
      cases: [c],
      summary: { total: 1, counts: {}, passRate: null },
    });
    fakeServer({
      'GET /api/runs': () => ({
        items: [
          run('r1', '2026-01-01T00:00:00Z', result('passed', '2026-01-01T00:00:00Z')),
          run(
            'r2',
            '2026-01-02T00:00:00Z',
            result('failed', '2026-01-02T00:00:00Z', {
              kind: 'assertion',
              message: 'Expected "Saved" to be visible.',
              expected: 'visible',
              actual: 'not visible',
            }),
          ),
        ],
      }),
    });
    go('/test-execution');
    const user = userEvent.setup();
    render(<App />);
    const row = (await screen.findByRole('button', { name: 'TC_1' })).closest('tr')!;
    expect(await within(row).findByText('Failed')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Show issue for TC_1' }));
    expect(within(row).getByRole('tooltip')).toHaveTextContent('Expected "Saved" to be visible.');
    expect(within(row).getByRole('link', { name: 'Open the run' })).toHaveAttribute(
      'href',
      `${HOME}/run-history/r2`,
    );
  });

  it('runs one case from its row, and leaves running to the selection bar once cases are selected', async () => {
    fakeServer();
    go('/test-execution');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Run TC_1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start a run' });
    expect(dialog).toHaveTextContent('1 test case');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('checkbox', { name: 'Select TC_1' }));
    expect(screen.queryByRole('button', { name: 'Run TC_1' })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Selected test cases' })).getByRole('button', {
        name: 'Run 1',
      }),
    ).toBeEnabled();
  });

  it('fills missing parameters automatically for the cases that need them', async () => {
    const server = fakeServer({
      'POST /api/parameters/auto': () => ({ configured: 1, filled: 1, stillMissing: [] }),
    });
    go('/test-execution');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Auto-fill parameters' }));
    await waitFor(() => expect(server.sent('POST', '/api/parameters/auto')).toHaveLength(1));
    expect(server.sent('POST', '/api/parameters/auto')[0]!.body).toEqual({
      caseIds: ['TC_1'],
      ai: true,
    });
    expect(await screen.findByText(/Filled 1 value in 1 case/)).toBeInTheDocument();
  });
});

describe('starting a run', () => {
  const group = (over: object) => ({
    caseCount: 1,
    environment: 'qa',
    loginRequired: true,
    available: true,
    accounts: [],
    ...over,
  });
  const accounts = [
    { id: 'a1', projectId: 1, label: 'Approver', username: 'ap@x', hasPassword: true },
    { id: 'a2', projectId: 1, label: 'Viewer', username: 'vi@x', hasPassword: true },
  ];
  const openDialog = async (button: string | RegExp = 'Run TC_1') => {
    go('/test-execution');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: button }));
    return { user, dialog: await screen.findByRole('dialog', { name: 'Start a run' }) };
  };

  it('asks for each project’s own accounts, and sends the ones chosen', async () => {
    const server = fakeServer({
      'POST /api/runs/plan': () => ({
        workers: 2,
        groups: [
          group({ projectId: 1, projectName: 'Capex', appUrl: 'https://capex.test', accounts }),
          group({
            projectId: 2,
            projectName: 'Open',
            environment: 'uat',
            appUrl: 'https://open.test',
            loginRequired: false,
          }),
        ],
      }),
      'POST /api/runs': () => ({ id: 'r1', cases: [], summary: {} }),
    });
    const { user, dialog } = await openDialog();
    expect(await within(dialog).findByText(/https:\/\/capex\.test/)).toBeInTheDocument();
    expect(within(dialog).getByText(/https:\/\/open\.test/)).toBeInTheDocument();
    const start = within(dialog).getByRole('button', { name: /^Start/ });
    expect(start).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox', { name: /Approver/ }));
    expect(start).toBeEnabled();
    await user.click(start);
    await waitFor(() => expect(server.sent('POST', '/api/runs')).toHaveLength(1));
    expect(server.sent('POST', '/api/runs')[0]!.body).toMatchObject({ accountIds: ['a1'] });
  });

  it('runs as every user at once in concurrent mode, with a browser for each', async () => {
    const server = fakeServer({
      'POST /api/runs/plan': () => ({
        workers: 1,
        groups: [
          group({ projectId: 1, projectName: 'Capex', appUrl: 'https://capex.test', accounts }),
        ],
      }),
      'POST /api/runs': () => ({ id: 'r1', cases: [], summary: {} }),
    });
    const { user, dialog } = await openDialog(/Concurrent run/);
    const together = await within(dialog).findByRole('checkbox', { name: /Concurrent users/ });
    expect(together).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /Approver/ })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /Viewer/ })).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Start 2 runs' }));
    await waitFor(() => expect(server.sent('POST', '/api/runs')).toHaveLength(1));
    expect(server.sent('POST', '/api/runs')[0]!.body).toMatchObject({
      accountIds: ['a1', 'a2'],
      workers: 2,
    });
  });

  it('will not start while a project is not set up, and links to it', async () => {
    fakeServer({
      'POST /api/runs/plan': () => ({
        groups: [
          group({
            projectId: 3,
            projectName: 'Capex',
            available: false,
            reason: 'Capex has no application address yet.',
          }),
        ],
      }),
    });
    const { dialog } = await openDialog();
    expect(await within(dialog).findByText(/no application address/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Set up the project' })).toHaveAttribute(
      'href',
      '/project/3/settings/general',
    );
    expect(within(dialog).getByRole('button', { name: /^Start/ })).toBeDisabled();
  });
});

describe('step cards and custom steps', () => {
  const scenario = (steps: unknown[]) => ({
    approved: {
      caseId: 'TC_1',
      scenario: { steps },
      status: 'approved',
      origin: 'manual',
      version: 1,
      updatedAt: '2026-01-01T00:00:00Z',
      issues: [],
      warnings: [],
    },
  });
  const open = async () => {
    go(`${HOME}/test-execution`);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'TC_1' }));
    return { user, dialog: await screen.findByRole('dialog', { name: /TC_1/ }) };
  };

  it('says each step in plain words and explains how steps work to a beginner', async () => {
    fakeServer();
    const { dialog } = await open();
    expect(await within(dialog).findByText('Click button “Delete”')).toBeInTheDocument();
    expect(within(dialog).getByText('How steps work')).toBeInTheDocument();
    expect(within(dialog).getByText(/Describe the element as you see it/)).toBeInTheDocument();
  });

  it('edits an application step as a form, never as JSON, and offers it only where it is already used', async () => {
    fakeServer({
      'GET /api/scenarios/TC_1': () =>
        scenario([
          {
            action: 'roles.assert-permission',
            params: { role: '{{data.roleName}}', resource: 'Project', action: 'Delete' },
          },
        ]),
    });
    const { user, dialog } = await open();
    expect(await within(dialog).findByDisplayValue('Project')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Step 1: Role')).toHaveValue('{{data.roleName}}');
    expect(within(dialog).queryByLabelText(/parameters \(JSON\)/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Extra settings')).not.toBeInTheDocument();
    // A new step cannot pick the application step: it is not used by any other step.
    await user.click(within(dialog).getByRole('button', { name: 'Add step' }));
    const options = within(within(dialog).getByLabelText('Step 2: action'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toContain('Check a permission');
    expect(options).not.toContain('Other project step');
    expect(options).toContain('Roles: assert permission'); // still listed: step 1 uses it
  });

  it('offers a project’s custom steps with their own fields', async () => {
    fakeServer();
    const { user, dialog } = await open();
    await user.click(await within(dialog).findByRole('button', { name: 'Add step' }));
    await user.selectOptions(within(dialog).getByLabelText('Step 2: action'), 'Check a permission');
    await user.type(within(dialog).getByLabelText('Step 2: Role'), 'Admin');
    expect(
      await within(dialog).findByText('Check a permission — Role: “Admin”'),
    ).toBeInTheDocument();
  });

  it('defines a custom step in Project settings and saves the whole list', async () => {
    const server = fakeServer({
      'PUT /api/custom-steps/1': (b) => ({
        items: (b as { items: object[] }).items.map((i) => ({
          ...i,
          action: `custom.1.${(i as { key: string }).key}`,
          usedBy: 0,
        })),
      }),
    });
    go(`${HOME}/settings/custom-steps`);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('No custom steps yet')).toBeInTheDocument();
    expect(screen.getByText('How a custom step works')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start from an example' }));
    const dialog = await screen.findByRole('dialog', { name: /New custom step/ });
    expect(
      within(dialog).getByDisplayValue('Open a page and check its heading'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('How it will look in a test case')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save custom step' }));
    await waitFor(() => expect(server.sent('PUT', '/api/custom-steps/1')).toHaveLength(1));
    expect(server.sent('PUT', '/api/custom-steps/1')[0]!.body).toMatchObject({
      items: [
        {
          key: 'open-page-and-check-heading',
          inputs: [
            { name: 'page', kind: 'page' },
            { name: 'heading', kind: 'text' },
          ],
          steps: [{ action: 'go-to-page', params: { page: '{{input.page}}' } }, {}],
        },
      ],
    });
    expect(
      await screen.findByText(/Saved “Open a page and check its heading”/),
    ).toBeInTheDocument();
  });

  it('shows the server’s reason when it refuses a custom step', async () => {
    fakeServer({
      'PUT /api/custom-steps/1': () =>
        httpError(400, '“X”: Step 1 (press): Invalid parameters.', 'invalid-custom-steps'),
    });
    go(`${HOME}/settings/custom-steps`);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Start from an example' }));
    const dialog = await screen.findByRole('dialog', { name: /New custom step/ });
    await user.click(within(dialog).getByRole('button', { name: 'Save custom step' }));
    expect(await within(dialog).findByText(/Invalid parameters/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /New custom step/ })).toBeInTheDocument();
  });
});

describe('the step editor', () => {
  const open = async () => {
    go('/test-execution');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'TC_1' }));
    return { user, dialog: await screen.findByRole('dialog', { name: /TC_1/ }) };
  };

  it('says what stands between the case and a run, and opens the tab that fixes it', async () => {
    fakeServer();
    const { user, dialog } = await open();
    const readiness = within(dialog).getByRole('complementary', { name: 'Readiness' });
    expect(await within(readiness).findByText('1 step, all valid')).toBeInTheDocument();
    expect(await within(readiness).findByText('Ready to run · v1')).toBeInTheDocument();
    await user.click(await within(readiness).findByRole('button', { name: /Parameters/ }));
    expect(within(dialog).getByRole('tab', { name: /Parameters/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('edits steps visually and saves with the version it opened, so nothing is overwritten', async () => {
    const server = fakeServer({
      'PUT /api/scenarios/TC_1': () => ({
        caseId: 'TC_1',
        scenario: { steps: [] },
        status: 'approved',
        origin: 'manual',
        version: 2,
        updatedAt: '2026-01-02T00:00:00Z',
        issues: [],
        warnings: [],
      }),
    });
    const { user, dialog } = await open();
    // The existing step is shown as fields, not JSON.
    expect(await within(dialog).findByDisplayValue('Delete')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add step' }));
    await user.selectOptions(within(dialog).getByLabelText('Step 2: action'), 'assert-text');
    await user.type(within(dialog).getByLabelText('Step 2: Text'), 'Project deleted');
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));
    await waitFor(() => expect(server.sent('PUT', '/api/scenarios/TC_1')).toHaveLength(1));
    expect(server.sent('PUT', '/api/scenarios/TC_1')[0]!.body).toEqual({
      steps: [
        { action: 'click', params: { target: { role: 'button', name: 'Delete' } } },
        { action: 'assert-text', params: { text: 'Project deleted' } },
      ],
      expectedVersion: 1,
    });
    expect(await screen.findByText(/Saved TC_1 as version 2/)).toBeInTheDocument();
  });

  it('says so, and keeps the edit, when someone else saved first', async () => {
    fakeServer({
      'PUT /api/scenarios/TC_1': () =>
        httpError(409, 'This test case was changed since you opened it.', 'changed-since-opened'),
    });
    const { user, dialog } = await open();
    const name = await within(dialog).findByDisplayValue('Delete');
    await user.clear(name);
    await user.type(name, 'Remove');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Someone else saved this case')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('Remove')).toBeInTheDocument();
  });

  it('asks before closing the popup with unsaved changes', async () => {
    fakeServer();
    const { user, dialog } = await open();
    await user.type(await within(dialog).findByDisplayValue('Delete'), 'X');
    await user.keyboard('{Escape}');
    const ask = await screen.findByRole('dialog', { name: 'Discard changes?' });
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: /TC_1/ })).toBeInTheDocument();
  });

  it('keeps parameters per case: auto-fills empty ones and saves the case’s own values', async () => {
    const server = fakeServer({
      'POST /api/parameters/TC_1/suggest': () => ({
        items: [{ name: 'project', value: 'QA-1', source: 'guess' }],
      }),
      'PUT /api/parameters/TC_1': (b) => ({
        caseId: 'TC_1',
        items: Object.entries((b as { values: Record<string, string> }).values).map(
          ([name, value]) => ({ name, value, used: true }),
        ),
        missing: [],
      }),
    });
    const { user, dialog } = await open();
    await user.click(within(dialog).getByRole('tab', { name: /Parameters/ }));
    const field = await within(dialog).findByLabelText(/^project/);
    await user.click(within(dialog).getByRole('button', { name: /Auto-fill/ }));
    await waitFor(() => expect(field).toHaveValue('QA-1'));
    expect(within(dialog).getByText('Suggested')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save parameters' }));
    await waitFor(() => expect(server.sent('PUT', '/api/parameters/TC_1')).toHaveLength(1));
    expect(server.sent('PUT', '/api/parameters/TC_1')[0]!.body).toEqual({
      values: { project: 'QA-1', role: 'Admin' },
    });
  });
});

describe('test case studio', () => {
  it('lists cases waiting for steps or approval, and marks the selected ones ready', async () => {
    const server = fakeServer({
      'POST /api/scenarios/approve': () => ({ approved: 1, skipped: [] }),
    });
    go(`${HOME}/test-cases`);
    const user = userEvent.setup();
    render(<App />);
    const status = await screen.findByRole('radiogroup', { name: 'Filter by automation status' });
    await user.click(await within(status).findByRole('radio', { name: /No steps/ }));
    const row = (await screen.findByRole('button', { name: 'TC_2' })).closest('tr')!;
    expect(within(row).getByText('No steps')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'TC_1' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Select TC_2' }));
    await user.click(
      within(screen.getByRole('region', { name: 'Selected test cases' })).getByRole('button', {
        name: 'Mark ready',
      }),
    );
    await waitFor(() => expect(server.sent('POST', '/api/scenarios/approve')).toHaveLength(1));
    expect(server.sent('POST', '/api/scenarios/approve')[0]!.body).toEqual({ caseIds: ['TC_2'] });
  });

  it('shows ready cases from the status filter', async () => {
    fakeServer();
    go(`${HOME}/test-cases`);
    const user = userEvent.setup();
    render(<App />);
    const status = await screen.findByRole('radiogroup', { name: 'Filter by automation status' });
    await user.click(within(status).getByRole('radio', { name: /Ready to run/ }));
    expect(await screen.findByRole('button', { name: 'TC_1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'TC_2' })).not.toBeInTheDocument();
  });

  it('only shows the cases of the project in the header', async () => {
    fakeServer({
      'GET /api/test-cases': () => ({
        total: 2,
        page: 1,
        pageSize: 200,
        items: [tcOf('TC_1'), tcOf('TC_OTHER', { projectId: 2 })],
      }),
    });
    go(`${HOME}/test-cases`);
    render(<App />);
    expect(await screen.findByRole('button', { name: 'TC_1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'TC_OTHER' })).not.toBeInTheDocument();
  });

  it('says how to turn on AI generation when no provider is set up', async () => {
    fakeServer();
    go(`${HOME}/test-cases`);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Create test cases' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create test cases' });
    await user.click(await within(dialog).findByRole('button', { name: /Generate with AI/ }));
    expect(
      await screen.findByText('Set up an AI provider to generate test cases'),
    ).toBeInTheDocument();
  });

  it('previews AI proposals without saving, and saves only the chosen ones into the project and version', async () => {
    const server = fakeServer({
      'GET /api/ai': () => ({ provider: 'anthropic', ready: true }),
      'POST /api/ai/cases/preview': () => ({
        cases: [
          { title: 'Sign in works', steps: ['Open', 'Sign in'], expectedResult: 'Home shows' },
          {
            title: 'Wrong password',
            steps: ['Open', 'Bad password'],
            expectedResult: 'Error shows',
          },
        ],
      }),
      'POST /api/ai/cases': () => ({ items: [{ id: 'TC_9', title: 'Sign in works' }] }),
      'POST /api/ai/generate': () => ({ id: 'job1', status: 'running', results: [] }),
      'GET /api/ai/jobs': () => ({
        items: [
          {
            id: 'job1',
            status: 'done',
            provider: 'fake',
            model: 'm',
            total: 1,
            done: 1,
            startedAt: '2026-01-01T00:00:00Z',
            results: [{ caseId: 'TC_9', outcome: 'drafted', message: 'Check by hand: the email.' }],
          },
        ],
      }),
    });
    window.localStorage.setItem(
      'qa-studio.work-context',
      JSON.stringify({ projectId: 1, versionId: 3 }),
    );
    go(`${HOME}/ai-assistant`);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText(/Save to General · v1\.0/)).toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText('Test suite'), 'Projects');
    await user.type(
      await screen.findByLabelText(/What should be tested/),
      'Sign in with good and bad passwords',
    );
    await user.click(screen.getByRole('button', { name: 'Generate test cases' }));
    expect(await screen.findByDisplayValue('Wrong password')).toBeInTheDocument();
    expect(server.sent('POST', '/api/ai/cases')).toHaveLength(0);
    await user.click(screen.getByRole('checkbox', { name: 'Keep "Wrong password"' }));
    await user.click(screen.getByRole('button', { name: 'Save selected (1)' }));
    await waitFor(() => expect(server.sent('POST', '/api/ai/cases')).toHaveLength(1));
    expect(server.sent('POST', '/api/ai/cases')[0]!.body).toMatchObject({
      cases: [{ title: 'Sign in works' }],
      projectId: 1,
      testSuiteId: 7,
      projectVersionId: 3,
    });
    await waitFor(() =>
      expect(server.sent('POST', '/api/ai/generate')[0]?.body).toEqual({ caseIds: ['TC_9'] }),
    );
    // The saved case's card says how step writing went, and what to check by hand.
    const saved = await screen.findByRole('region', { name: 'Saved test cases' });
    expect(await within(saved).findByText('Steps ready to review')).toBeInTheDocument();
    expect(within(saved).getByText('Check by hand: the email.')).toBeInTheDocument();
  });

  it('fills in the next ID for a new case and files it in the chosen version', async () => {
    const server = fakeServer({
      'GET /api/test-cases/next-id': () => ({ id: 'TC_03' }),
      'POST /api/test-cases': (b) => tcOf('TC_03', b as object),
    });
    go(`${HOME}/test-cases`);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Create test cases' }));
    const create = await screen.findByRole('dialog', { name: 'Create test cases' });
    await user.click(await within(create).findByRole('button', { name: /Write by hand/ }));
    const dialog = await screen.findByRole('dialog', { name: 'New test case' });
    expect(await within(dialog).findByDisplayValue('TC_03')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Title/), 'Delete a draft');
    await user.click(within(dialog).getByRole('button', { name: 'Create and add steps' }));
    await waitFor(() => expect(server.sent('POST', '/api/test-cases')).toHaveLength(1));
    // The suggested ID is not sent: the server takes the next free one when it creates the case.
    const body = server.sent('POST', '/api/test-cases')[0]!.body;
    expect(body).not.toHaveProperty('id');
    expect(body).toMatchObject({ projectVersionId: 3 });
  });

  it('uploads, imports the chosen worksheet into the project and version and starts converting', async () => {
    const summary = {
      id: 'imp1',
      fileName: 'plan.xlsx',
      defaultSelection: ['Cases'],
      sheets: [
        {
          name: 'Cases',
          status: 'valid',
          headerRow: 1,
          columnCount: 2,
          sample: [
            ['ID', 'Title'],
            ['TC_9', 'New'],
          ],
          mapping: { id: 1, title: 2 },
          autoHeaderRow: 1,
          autoMapping: { id: 1, title: 2 },
          detectedCount: 1,
          rejectedCount: 0,
          warningCount: 0,
        },
      ],
    };
    const job = {
      id: 'job1',
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
      total: 1,
      counts: { pending: 1, ready: 0, 'needs-review': 0, failed: 0, skipped: 0 },
      items: [{ caseId: 'TC_9', title: 'New', status: 'pending', steps: 0 }],
    };
    let jobs: unknown[] = [];
    const server = fakeServer({
      'POST /api/imports': () => summary,
      'GET /api/imports/imp1/cases': () => ({ total: 1, items: [], rejectedCount: 0 }),
      'POST /api/imports/imp1/commit': () => ({
        added: 1,
        updated: 0,
        removed: 0,
        total: 3,
        rejected: 0,
        caseIds: ['TC_9'],
      }),
      'POST /api/conversions': () => {
        jobs = [job];
        return job;
      },
      'GET /api/conversions': () => ({ items: jobs }),
    });
    go(`${HOME}/test-cases`);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Create test cases' }));
    const create = await screen.findByRole('dialog', { name: 'Create test cases' });
    await user.selectOptions(within(create).getByLabelText('Test suite'), 'Projects');
    await user.click(within(create).getByRole('button', { name: /Import from Excel/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Import test cases from Excel' });
    await user.upload(
      within(dialog).getByLabelText('Excel workbook (.xlsx)'),
      new File(['x'], 'plan.xlsx'),
    );
    expect(await within(dialog).findByText('Auto-detected')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.click(
      await within(dialog).findByRole('button', { name: /Import and convert 1 case/ }),
    );
    await waitFor(() =>
      expect(server.sent('POST', '/api/conversions')[0]?.body).toEqual({ caseIds: ['TC_9'] }),
    );
    expect(server.sent('POST', '/api/imports/imp1/commit')[0]!.body).toMatchObject({
      projectId: 1,
      testSuiteId: 7,
      projectVersionId: 3,
    });
  });
});

describe('sign-in users', () => {
  it('lists each project’s users and adds several at once', async () => {
    let n = 0;
    const server = fakeServer({
      'GET /api/project-connections': () => ({
        items: [
          {
            projectId: 1,
            envName: 'qa',
            appUrl: 'https://qa.example.com',
            login: { strategy: 'login-form', path: '/login', signedInMarker: '' },
            ready: true,
          },
        ],
        allowedEnvs: ['qa'],
      }),
      'GET /api/accounts': () => ({
        items: [{ id: 'a1', projectId: 1, label: 'Approver', username: 'ap@x', hasPassword: true }],
      }),
      'POST /api/accounts': (b) => ({ id: `n${++n}`, ...(b as object), hasPassword: true }),
    });
    go('/sign-in-users');
    const user = userEvent.setup();
    render(<App />);
    const section = await screen.findByRole('region', { name: 'General' });
    expect(within(section).getByText('Approver')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Add several users' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add users to General' });
    const names = within(dialog).getAllByLabelText('Name');
    const users = within(dialog).getAllByLabelText('Username');
    const passwords = within(dialog).getAllByLabelText('Password');
    for (const i of [0, 1]) {
      await user.type(names[i]!, `Requester ${i + 1}`);
      await user.type(users[i]!, `r${i + 1}@x`);
      await user.type(passwords[i]!, 'secret-pass');
    }
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 users' }));
    await waitFor(() => expect(server.sent('POST', '/api/accounts')).toHaveLength(2));
    expect(server.sent('POST', '/api/accounts')[1]!.body).toEqual({
      projectId: 1,
      label: 'Requester 2',
      username: 'r2@x',
      password: 'secret-pass',
    });
  });
});

describe('azure devops', () => {
  it('saves the connection with the token write-only, then offers the plan suites', async () => {
    let view = {
      config: {},
      hasToken: false,
      ready: false,
      reason: 'Enter the organization URL and project.',
    };
    const server = fakeServer({
      'GET /api/azure-devops': () => view,
      'PUT /api/azure-devops': (b) => {
        view = { ...view, config: b as object };
        return view;
      },
      'PUT /api/azure-devops/token': () => {
        view = { ...view, hasToken: true, ready: true, reason: '' };
        return view;
      },
      'GET /api/azure-devops/plans': () => ({ items: [{ id: 7, name: 'Release 2' }] }),
      'GET /api/azure-devops/plans/7/suites': () => ({ items: [{ id: 11, name: 'Checkout' }] }),
      'GET /api/azure-devops/jobs': () => ({ items: [] }),
    });
    go('/azure-devops');
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('Not connected')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Organization URL/), 'https://dev.azure.com/contoso');
    await user.type(screen.getByRole('textbox', { name: /^Project/ }), 'Shop');
    await user.type(screen.getByLabelText(/Personal Access Token/), 'abcdefghijklmnopqrstuvwxyz');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    await waitFor(() => expect(server.sent('PUT', '/api/azure-devops/token')).toHaveLength(1));
    expect(server.sent('PUT', '/api/azure-devops')[0]!.body).toMatchObject({
      orgUrl: 'https://dev.azure.com/contoso',
      project: 'Shop',
    });
    expect(JSON.stringify(server.sent('PUT', '/api/azure-devops')[0]!.body)).not.toContain(
      'abcdefghij',
    );
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText('Test plan'), 'Release 2');
    expect(await screen.findByRole('option', { name: 'Checkout' })).toBeInTheDocument();
  });
});

describe('project versions', () => {
  it('lists versions and adds one to the chosen project', async () => {
    const server = fakeServer({
      'POST /api/project-versions': (b) => ({
        id: 4,
        projectName: 'General',
        testCaseCount: 0,
        isActive: true,
        rowVersion: 'A',
        ...(b as object),
      }),
    });
    go('/projects/versions');
    const user = userEvent.setup();
    render(<App />);
    const table = await screen.findByRole('table', { name: 'Project versions' });
    expect(await within(table).findByText('1.0')).toBeInTheDocument();
    expect(within(table).getByText('Current')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New version' }));
    const dialog = await screen.findByRole('dialog', { name: 'New version' });
    await user.type(within(dialog).getByLabelText(/^Version/), '2.0');
    await user.click(within(dialog).getByRole('checkbox', { name: /Current version/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(server.sent('POST', '/api/project-versions')).toHaveLength(1));
    expect(server.sent('POST', '/api/project-versions')[0]!.body).toEqual({
      projectId: 1,
      name: '2.0',
      isCurrent: true,
      isActive: true,
    });
  });
});

describe('parameters from the project', () => {
  it('lets a value come from the project common value instead of the case', async () => {
    const server = fakeServer({
      'GET /api/parameters/TC_1': () => ({
        caseId: 'TC_1',
        projectId: 1,
        items: [
          { name: 'project', value: '', common: 'PRJ-COMMON', source: 'common', used: true },
          { name: 'role', value: 'Admin', source: 'case', used: true },
        ],
        missing: [],
      }),
      'PUT /api/parameters/TC_1': (b) => ({
        caseId: 'TC_1',
        items: [],
        missing: [],
        ...(b as object),
      }),
    });
    go('/test-execution');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'TC_1' }));
    const dialog = await screen.findByRole('dialog', { name: /TC_1/ });
    await user.click(within(dialog).getByRole('tab', { name: /Parameters/ }));
    const projectSource = await within(dialog).findByRole('radiogroup', {
      name: 'Source of project',
    });
    expect(within(projectSource).getByRole('radio', { name: 'Project common' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(dialog).getByText('PRJ-COMMON')).toBeInTheDocument();
    // Switch "role" to the project value: the case's own value is dropped on save.
    const roleSource = within(dialog).getByRole('radiogroup', { name: 'Source of role' });
    await user.click(within(roleSource).getByRole('radio', { name: 'Project common' }));
    expect(within(dialog).getByText(/No common value yet/)).toBeInTheDocument();
    await user.click(within(roleSource).getByRole('radio', { name: 'This case' }));
    await user.clear(within(dialog).getByLabelText(/^role/));
    await user.type(within(dialog).getByLabelText(/^role/), 'Viewer');
    await user.click(within(dialog).getByRole('button', { name: 'Save parameters' }));
    await waitFor(() => expect(server.sent('PUT', '/api/parameters/TC_1')).toHaveLength(1));
    expect(server.sent('PUT', '/api/parameters/TC_1')[0]!.body).toEqual({
      values: { project: '', role: 'Viewer' },
    });
  });

  it('edits the common values of a project, showing how many cases use them', async () => {
    const server = fakeServer({
      'PUT /api/parameters/common/1': (b) => ({
        projectId: 1,
        items: [
          {
            name: 'project',
            value: (b as { values: { project: string } }).values.project,
            usedBy: 2,
            overriddenBy: 0,
          },
        ],
      }),
    });
    go('/projects/parameters');
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('2 cases use it')).toBeInTheDocument();
    await user.type(screen.getByLabelText('project'), 'PRJ-1');
    await user.click(screen.getByRole('button', { name: 'Save common parameters' }));
    await waitFor(() => expect(server.sent('PUT', '/api/parameters/common/1')).toHaveLength(1));
    expect(server.sent('PUT', '/api/parameters/common/1')[0]!.body).toEqual({
      values: { project: 'PRJ-1' },
    });
  });
});

describe('ai assistant', () => {
  it('puts the prompt first, with the other AI jobs in their own tabs', async () => {
    fakeServer({ 'GET /api/ai': () => ({ provider: 'anthropic', ready: true }) });
    go('/ai-assistant');
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'AI Assistant', level: 1 }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText(/What should be tested/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Generate test cases' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Write steps for existing cases' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Teach the AI your app' })).toBeInTheDocument();
    expect(screen.getByText('AI ready · anthropic')).toBeInTheDocument();
  });

  it('shows a refused case as needing a manual check, with what to do', async () => {
    fakeServer({
      'GET /api/ai': () => ({ provider: 'anthropic', ready: true }),
      'GET /api/ai/jobs': () => ({
        items: [
          {
            id: 'j',
            status: 'done',
            provider: 'fake',
            model: 'm',
            total: 1,
            done: 1,
            startedAt: '2026-01-01T00:00:00Z',
            results: [{ caseId: 'TC_2', outcome: 'unmappable', message: 'Needs an email inbox.' }],
          },
        ],
      }),
    });
    go('/ai-assistant');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('tab', { name: 'Write steps for existing cases' }));
    expect(await screen.findByText('Needs a manual check')).toBeInTheDocument();
    expect(screen.getByText('Needs an email inbox.')).toBeInTheDocument();
    expect(screen.queryByText('Cannot be automated yet')).not.toBeInTheDocument();
  });
});

describe('an outdated worker', () => {
  it('is named once at the top of every page, with how to fix it', async () => {
    fakeServer({
      'GET /api/automation': () => ({
        runsAvailable: true,
        environment: 'qa',
        scenarioCount: 1,
        actions: [],
      }),
    });
    render(<App />);
    expect(await screen.findByText('The QA Studio worker is out of date')).toBeInTheDocument();
  });

  it('says how to restart it in the parameters tab, lists what the steps read, and retries', async () => {
    let upToDate = false;
    fakeServer({
      'GET /api/scenarios/TC_1': () => ({
        approved: {
          caseId: 'TC_1',
          scenario: {
            steps: [
              { action: 'fill', params: { target: { label: 'Role' }, value: '{{data.roleName}}' } },
            ],
          },
          status: 'approved',
          origin: 'manual',
          version: 1,
          updatedAt: '2026-01-01T00:00:00Z',
          issues: [],
          warnings: [],
        },
      }),
      'GET /api/parameters/TC_1': () =>
        upToDate
          ? {
              caseId: 'TC_1',
              items: [{ name: 'roleName', value: 'Admin', source: 'case', used: true }],
              missing: [],
            }
          : httpError(404, 'This server has no GET /api/parameters/TC_1.', 'route-not-found'),
    });
    go('/test-execution');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'TC_1' }));
    const dialog = await screen.findByRole('dialog', { name: /TC_1/ });
    // Not reported as a missing value: the values could not be read at all.
    expect(
      await within(dialog).findByText('Parameters cannot be checked: restart the worker'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('tab', { name: /Parameters/ }));
    expect(
      await within(dialog).findByText('The test runner needs a restart to show parameters'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('roleName')).toBeInTheDocument();
    upToDate = true;
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findByDisplayValue('Admin')).toBeInTheDocument();
    expect(await within(dialog).findByText('All steps are valid')).toBeInTheDocument();
  });
});

describe('clean addresses', () => {
  it('navigates with real paths and the back button, without reloading', async () => {
    fakeServer();
    go(`${HOME}/dashboard`);
    const user = userEvent.setup();
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(await within(nav).findByRole('link', { name: 'Run History' })).toHaveAttribute(
      'href',
      `${HOME}/run-history`,
    );
    await user.click(within(nav).getByRole('link', { name: 'Test Execution' }));
    expect(
      await screen.findByRole('heading', { name: 'Test Execution', level: 1 }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe(`${HOME}/test-execution`);
    window.history.back();
    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument();
  });
});

describe('settings', () => {
  it('shows one section at a time from the sub-menu', async () => {
    fakeServer();
    go('/settings/audit');
    render(<App />);
    const sub = await screen.findByRole('navigation', { name: 'Settings sections' });
    expect(within(sub).getByRole('link', { name: 'Audit log' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByRole('heading', { name: 'Clear all data' })).not.toBeInTheDocument();
  });

  it('edits the pages of one project apart from the shared list', async () => {
    const server = fakeServer({
      'PUT /api/pages': (b) => ({ items: (b as { pages: unknown[] }).pages }),
    });
    go('/settings/pages');
    const user = userEvent.setup();
    render(<App />);
    const of = await screen.findByLabelText('Pages of');
    await waitFor(() => expect(within(of).getAllByRole('option')).toHaveLength(2));
    await user.selectOptions(of, 'General only');
    await user.click(screen.getByRole('button', { name: 'Add page' }));
    await user.type(screen.getByLabelText('Page 2 name'), 'Home');
    await user.click(screen.getByRole('button', { name: 'Save pages' }));
    await waitFor(() => expect(server.sent('PUT', '/api/pages')).toHaveLength(1));
    expect(server.sent('PUT', '/api/pages')[0]!.body).toMatchObject({ projectId: 1 });
  });

  it('turns voice on with the wake phrase, says LiveKit is missing, and saves the generator defaults', async () => {
    const voice = {
      enabled: false,
      activation: 'ptt',
      wakePhrase: 'hey_qa_studio',
      sensitivity: 0.5,
      idleTimeoutSec: 20,
      pauseWhenHidden: true,
      sounds: true,
      model: 'google/gemini-2.5-flash',
      coverage: 'standard',
      format: 'steps',
      language: 'en',
      livekitConfigured: false,
      wakePhrases: [{ id: 'hey_qa_studio', label: 'Hey QA Studio' }],
      modelSuggestions: ['google/gemini-2.5-flash'],
    };
    const server = fakeServer({
      'GET /api/voice': () => voice,
      'PUT /api/voice': (b) => ({ ...voice, ...(b as object) }),
    });
    go('/settings/voice');
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('Voice needs LiveKit on the server')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Turn on voice control/ }));
    await user.click(screen.getByRole('radio', { name: /Wake phrase/ }));
    expect(screen.getByLabelText('Wake phrase')).toHaveValue('hey_qa_studio');
    await user.selectOptions(screen.getByLabelText('Coverage level'), 'thorough');
    await user.click(screen.getByRole('button', { name: 'Save voice settings' }));
    await waitFor(() => expect(server.sent('PUT', '/api/voice')).toHaveLength(1));
    expect(server.sent('PUT', '/api/voice')[0]!.body).toMatchObject({
      enabled: true,
      activation: 'wake',
      coverage: 'thorough',
    });
  });
});
