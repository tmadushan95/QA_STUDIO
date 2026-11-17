// @vitest-environment jsdom
/**
 * UI tests of the main flows: project-first navigation (project list, project and version switchers), Test Case
 * Studio (create, review, mark ready), Test Execution (run, concurrent users, parameters), the step editor popup (save, conflicts, unsaved changes), the import → conversion flow,
 * Sign-in Users, Azure DevOps, project versions, the dashboard and the settings sub-menu.
 */
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, httpError, tc as tcOf } from '../test/fake-server.js';
import { App } from './App.js';
import { StartRunDialog } from '../features/runs/components/StartRunDialog.js';

// Pages load on first visit (code splitting); the first visit in a test run can take over a second.
configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  // The work context (project and version) is remembered per browser; every test starts without one.
  window.localStorage.clear();
  // So are unsaved AI proposals, per browser tab.
  window.sessionStorage.clear();
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
  it('gives the page to the list: no side panel or run-all buttons, and search opens from a button', async () => {
    fakeServer();
    go('/test-execution');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('rowheader', { name: 'TC_1' });
    expect(screen.queryByText('Recent runs')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Run all shown|Concurrent run/ })).toBeNull();
    // Search folds into a button, opens focused, and folds away again when left empty.
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Search' }));
    const box = screen.getByRole('searchbox', { name: 'Search test cases' });
    expect(box).toHaveFocus();
    await user.type(box, 'zzzz');
    await waitFor(() => expect(screen.queryByRole('rowheader', { name: 'TC_1' })).toBeNull());
    await user.clear(box);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('lists only cases that are ready, with their parameters and last result', async () => {
    fakeServer();
    go('/test-execution');
    render(<App />);
    const row = (await screen.findByRole('rowheader', { name: 'TC_1' })).closest('tr')!;
    expect(within(row).getByText('1 missing')).toBeInTheDocument();
    expect(within(row).getByText('Not run yet')).toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: 'TC_2' })).not.toBeInTheDocument();
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
    const row = (await screen.findByRole('rowheader', { name: 'TC_1' })).closest('tr')!;
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
  /** Opens "Start a run" from a row's Run button, or (`'concurrent'`) by ticking TC_1 and using the selection bar. */
  const openDialog = async (button: 'concurrent' | string = 'Run TC_1') => {
    go('/test-execution');
    const user = userEvent.setup();
    render(<App />);
    if (button === 'concurrent') {
      await user.click(await screen.findByRole('checkbox', { name: 'Select TC_1' }));
      const bar = screen.getByRole('region', { name: 'Selected test cases' });
      await user.click(within(bar).getByRole('button', { name: 'Concurrent run' }));
    } else {
      await user.click(await screen.findByRole('button', { name: button }));
    }
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
    // The recommended way to run is chosen unless the person picks another.
    expect(server.sent('POST', '/api/runs')[0]!.body).toMatchObject({
      accountIds: ['a1'],
      mode: 'clean',
    });
  });

  it('makes a long list of users quick to choose from: search, select the ones shown, clear', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `u${i + 1}`,
      projectId: 1,
      label: i < 3 ? `Approver ${i + 1}` : `Viewer ${i + 1}`,
      username: `user${i + 1}@x`,
      hasPassword: true,
    }));
    fakeServer({
      'POST /api/runs/plan': () => ({
        groups: [
          group({
            projectId: 1,
            projectName: 'Capex',
            appUrl: 'https://capex.test',
            accounts: many,
          }),
        ],
      }),
    });
    const { user, dialog } = await openDialog();
    expect(await within(dialog).findByText('0 of 12 chosen')).toBeInTheDocument();
    await user.type(
      within(dialog).getByRole('searchbox', { name: /Search Capex users/ }),
      'approver',
    );
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(3);
    await user.click(within(dialog).getByRole('button', { name: 'Select shown' }));
    expect(within(dialog).getByText('3 of 12 chosen')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^Start 3 runs/ })).toBeEnabled();
    await user.click(within(dialog).getByRole('button', { name: 'Clear' }));
    expect(within(dialog).getByText('0 of 12 chosen')).toBeInTheDocument();
    await user.clear(within(dialog).getByRole('searchbox', { name: /Search Capex users/ }));
    await user.type(
      within(dialog).getByRole('searchbox', { name: /Search Capex users/ }),
      'nobody',
    );
    expect(within(dialog).getByText(/No user matches/)).toBeInTheDocument();
  });

  it('offers one shared window only when there are two or more test cases', async () => {
    fakeServer({
      'POST /api/runs/plan': () => ({
        groups: [
          group({ projectId: 1, projectName: 'Capex', appUrl: 'https://capex.test', accounts }),
        ],
      }),
    });
    const { dialog } = await openDialog();
    const shared = await within(dialog).findByRole('radio', { name: /Same window/ });
    expect(shared).toBeDisabled();
    expect(within(dialog).getByText('Needs 2+ test cases')).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Fresh window/ })).toBeEnabled();
    expect(within(dialog).getByRole('radio', { name: /Concurrent users/ })).toBeEnabled();
  });

  it('runs every case in one shared window, one at a time, when that is chosen', async () => {
    const server = fakeServer({
      'POST /api/runs/plan': () => ({
        workers: 3,
        groups: [
          group({
            projectId: 1,
            projectName: 'Capex',
            appUrl: 'https://capex.test',
            caseCount: 2,
            accounts,
          }),
        ],
      }),
      'POST /api/runs': () => ({ id: 'r1', cases: [], summary: {} }),
    });
    // Two test cases: sharing a window only means something when a user runs more than one.
    const user = userEvent.setup();
    render(
      <StartRunDialog
        caseIds={['TC_1', 'TC_2']}
        onClose={() => undefined}
        onStarted={() => undefined}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Start a run' });
    const fresh = await within(dialog).findByRole('radio', { name: /Fresh window/ });
    expect(fresh).toBeChecked();
    await user.click(within(dialog).getByRole('checkbox', { name: /Approver/ }));
    expect(within(dialog).getByRole('spinbutton', { name: /Windows at once/ })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: /Same window/ }));
    // One shared window runs one case at a time, so there is no number to choose.
    expect(within(dialog).queryByRole('spinbutton')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /^Start/ }));
    await waitFor(() => expect(server.sent('POST', '/api/runs')).toHaveLength(1));
    expect(server.sent('POST', '/api/runs')[0]!.body).toMatchObject({
      accountIds: ['a1'],
      mode: 'shared',
      workers: 1,
    });
  });

  it('runs the chosen users at once in concurrent mode, with a browser for each', async () => {
    const server = fakeServer({
      'POST /api/runs/plan': () => ({
        workers: 1,
        groups: [
          group({ projectId: 1, projectName: 'Capex', appUrl: 'https://capex.test', accounts }),
        ],
      }),
      'POST /api/runs': () => ({ id: 'r1', cases: [], summary: {} }),
    });
    const { user, dialog } = await openDialog('concurrent');
    const together = await within(dialog).findByRole('radio', { name: /Concurrent users/ });
    expect(together).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: /Different users/ })).toBeChecked();
    // Nobody is ticked for the person: they choose who signs in.
    const approver = within(dialog).getByRole('checkbox', { name: /Approver/ });
    const viewer = within(dialog).getByRole('checkbox', { name: /Viewer/ });
    expect(approver).not.toBeChecked();
    expect(viewer).not.toBeChecked();
    expect(within(dialog).getByRole('button', { name: /^Start/ })).toBeDisabled();
    await user.click(approver);
    expect(within(dialog).getByRole('status')).toHaveTextContent(/Only one user is ticked/);
    await user.click(viewer);
    await user.click(within(dialog).getByRole('button', { name: 'Start 2 runs' }));
    await waitFor(() => expect(server.sent('POST', '/api/runs')).toHaveLength(1));
    const body = server.sent('POST', '/api/runs')[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({ accountIds: ['a1', 'a2'], workers: 2, mode: 'concurrent' });
    expect(body).not.toHaveProperty('browsersPerUser');
  });

  it('runs one user in several browsers at once when that is chosen', async () => {
    const server = fakeServer({
      'POST /api/runs/plan': () => ({
        workers: 1,
        groups: [
          group({ projectId: 1, projectName: 'Capex', appUrl: 'https://capex.test', accounts }),
        ],
      }),
      'POST /api/runs': () => ({ id: 'r1', cases: [], summary: {} }),
    });
    const { user, dialog } = await openDialog('concurrent');
    await user.click(await within(dialog).findByRole('radio', { name: /Same user in several/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /Approver/ }));
    const perUser = within(dialog).getByRole('spinbutton', { name: /Browsers per user/ });
    await user.clear(perUser);
    await user.type(perUser, '3');
    await user.click(within(dialog).getByRole('button', { name: 'Start 3 runs' }));
    await waitFor(() => expect(server.sent('POST', '/api/runs')).toHaveLength(1));
    expect(server.sent('POST', '/api/runs')[0]!.body).toMatchObject({
      accountIds: ['a1'],
      mode: 'concurrent',
      browsersPerUser: 3,
      workers: 3,
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
    await user.click(await screen.findByRole('button', { name: 'Actions for TC_1' }));
    await user.click(screen.getByRole('menuitem', { name: 'View steps' }));
    return { user, dialog: await screen.findByRole('dialog', { name: /TC_1/ }) };
  };

  // A step's sentence highlights its values in their own elements, so it is matched on its whole text.
  const sentence = (text: string) => (_: string, el: Element | null) =>
    el?.tagName === 'P' && el.textContent === text;

  it('says each step in plain words and explains how steps work to a beginner', async () => {
    fakeServer();
    const { dialog } = await open();
    expect(await within(dialog).findByText(sentence('Click button “Delete”'))).toBeInTheDocument();
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
    // A value that is just a parameter shows as a chip, never as {{data.roleName}}.
    expect(within(dialog).getByRole('group', { name: 'Step 1: Role' })).toHaveTextContent(
      'roleName',
    );
    expect(within(dialog).queryByDisplayValue('{{data.roleName}}')).not.toBeInTheDocument();
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
      await within(dialog).findByText(sentence('Check a permission — Role: “Admin”')),
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

  it('opens a new custom step full screen and says in words what is missing before Save', async () => {
    fakeServer();
    go(`${HOME}/settings/custom-steps`);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /New custom step/ }));
    const dialog = await screen.findByRole('dialog', { name: /New custom step/ });
    expect(within(dialog).getByRole('button', { name: 'Exit full screen' })).toBeInTheDocument();
    expect(within(dialog).getByText('To save: give it a name.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save custom step' })).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox', { name: /^Name/ }), 'Check a role');
    expect(within(dialog).getByText('To save: add at least one step.')).toBeInTheDocument();
    const checklist = within(dialog).getByRole('region', { name: 'Ready to save?' });
    expect(within(checklist).getByText('Name given')).toBeInTheDocument();
    // An input shows its boxes with visible labels.
    await user.click(within(dialog).getByRole('button', { name: 'Add input' }));
    expect(within(dialog).getByText('Label shown to testers')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Input 1: label')).toHaveFocus();
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

describe('a run in progress', () => {
  it('shows a live view: what is finished, a tile per result, and cases filtered by result', async () => {
    const at = new Date(Date.now() - 65_000).toISOString();
    const result = (caseId: string, status: string) => ({
      caseId,
      title: `Case ${caseId}`,
      status,
      ...(status !== 'queued' && { startedAt: at }),
      steps: [],
      artifacts: [],
    });
    fakeServer({
      'GET /api/runs/r9': () => ({
        id: 'r9',
        status: 'running',
        createdAt: at,
        startedAt: at,
        environment: 'qa',
        browser: 'chromium',
        workers: 2,
        cases: [result('TC_1', 'passed'), result('TC_2', 'running'), result('TC_3', 'queued')],
        summary: {
          total: 3,
          counts: {
            queued: 1,
            running: 1,
            passed: 1,
            failed: 0,
            skipped: 0,
            blocked: 0,
            cancelled: 0,
          },
          passRate: 1,
        },
      }),
    });
    go(`${HOME}/run-history/r9`);
    const user = userEvent.setup();
    render(<App />);
    const progress = await screen.findByRole('region', { name: 'Run progress' });
    expect(within(progress).getByText(/Live · running/)).toBeInTheDocument();
    expect(within(progress).getByText('1 of 3 finished')).toBeInTheDocument();
    expect(within(progress).getByRole('progressbar', { name: 'Cases finished' })).toHaveAttribute(
      'aria-valuenow',
      '1',
    );
    expect(within(progress).getByText('Elapsed')).toBeInTheDocument();
    const tiles = within(progress).getByRole('list', { name: 'Results so far' });
    expect(within(tiles).getByText('Running').previousElementSibling).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Cancel run' })).toBeInTheDocument();

    const cases = screen.getByRole('list', { name: 'Cases in this run' });
    expect(within(cases).getAllByRole('listitem')).toHaveLength(3);
    await user.click(screen.getByRole('radio', { name: /^Running/ }));
    expect(within(cases).getAllByRole('listitem')).toHaveLength(1);
    expect(within(cases).getByText('TC_2')).toBeInTheDocument();
  });

  it('shows each step as a sentence, and the action name for runs saved before sentences existed', async () => {
    const at = '2026-01-01T00:00:00Z';
    fakeServer({
      'GET /api/runs/r8': () => ({
        id: 'r8',
        status: 'passed',
        createdAt: at,
        environment: 'qa',
        browser: 'chromium',
        workers: 1,
        cases: [
          {
            caseId: 'TC_1',
            status: 'passed',
            startedAt: at,
            steps: [
              {
                index: 0,
                action: 'click',
                description: 'Click button "Delete"',
                status: 'passed',
                durationMs: 5,
              },
              { index: 1, action: 'wait-for', status: 'passed', durationMs: 5 },
            ],
            artifacts: [],
          },
        ],
        summary: { total: 1, counts: { passed: 1 }, passRate: 1 },
      }),
    });
    go(`${HOME}/run-history/r8`);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /TC_1/ }));
    expect(screen.getByText('Click button "Delete"')).toHaveAttribute('title', 'click');
    expect(screen.getByText('wait-for').tagName).toBe('CODE');
  });
});

describe('the step editor', () => {
  const open = async () => {
    go('/test-execution');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Actions for TC_1' }));
    await user.click(screen.getByRole('menuitem', { name: 'View steps' }));
    return { user, dialog: await screen.findByRole('dialog', { name: /TC_1/ }) };
  };

  it('opens a case from its row menu, full screen', async () => {
    fakeServer();
    go('/test-execution');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Actions for TC_1' }));
    await user.click(screen.getByRole('menuitem', { name: 'View steps' }));
    const dialog = await screen.findByRole('dialog', { name: /TC_1/ });
    expect(within(dialog).getByRole('button', { name: 'Exit full screen' })).toBeInTheDocument();
  });

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

  it('asks before the footer Close drops unsaved changes, and closes at once without them', async () => {
    fakeServer();
    const { user, dialog } = await open();
    const close = () => within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!;
    await user.type(await within(dialog).findByDisplayValue('Delete'), 'X');
    await user.click(close());
    const ask = await screen.findByRole('dialog', { name: 'Discard changes?' });
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(within(dialog).getByDisplayValue('DeleteX')).toBeInTheDocument();
    const name = within(dialog).getByDisplayValue('DeleteX');
    await user.clear(name);
    await user.type(name, 'Delete');
    await user.click(close());
    expect(screen.queryByRole('dialog', { name: /TC_1/ })).not.toBeInTheDocument();
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

  it('asks AI for changed steps, shows them next to the current ones, and saves only when told', async () => {
    const server = fakeServer({
      'POST /api/ai/steps/revise': (b) => ({
        steps: [
          ...(b as { steps: unknown[] }).steps,
          { action: 'assert-text', params: { text: 'Are you sure?' } },
        ],
        note: 'Based on the action catalog.',
        issues: [],
        warnings: [],
      }),
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
    const ask = await within(dialog).findByRole('textbox', { name: 'Improve with AI' });
    await user.type(ask, 'Check the message in the popup');
    await user.click(within(dialog).getByRole('button', { name: 'Ask AI' }));
    const compare = await within(dialog).findByRole('table', {
      name: "Your steps and the AI's steps",
    });
    expect(server.sent('POST', '/api/ai/steps/revise')[0]!.body).toMatchObject({
      caseId: 'TC_1',
      instruction: 'Check the message in the popup',
    });
    expect(within(compare).getByText('Check “Are you sure?” is shown')).toBeInTheDocument();
    expect(within(compare).getByText('New')).toBeInTheDocument();
    // Nothing is saved by asking.
    expect(server.sent('PUT', '/api/scenarios/TC_1')).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Use these steps' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save & close' }));
    await waitFor(() => expect(server.sent('PUT', '/api/scenarios/TC_1')).toHaveLength(1));
    expect(server.sent('PUT', '/api/scenarios/TC_1')[0]!.body).toMatchObject({
      steps: [
        { action: 'click', params: { target: { role: 'button', name: 'Delete' } } },
        { action: 'assert-text', params: { text: 'Are you sure?' } },
      ],
    });
  });
});

describe('editing a test case', () => {
  it('edits the written case from the row menu and saves it with the version it opened', async () => {
    const first = {
      ...tcOf('TC_1', { steps: [{ order: 1, action: 'Click Delete', expected: 'A popup opens' }] }),
      testSuiteId: 1,
      rowVersion: 'v1',
    };
    const server = fakeServer({
      'GET /api/test-cases': () => ({
        total: 2,
        page: 1,
        pageSize: 200,
        items: [first, tcOf('TC_2')],
      }),
      'PUT /api/test-cases/TC_1': (b) => ({ ...first, ...(b as object), rowVersion: 'v2' }),
    });
    go(`${HOME}/test-cases`);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Actions for TC_1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit test case' }));
    const dialog = await screen.findByRole('dialog', { name: /TC_1/ });
    const form = within(dialog).getByRole('form', { name: 'Edit test case' });
    const title = within(form).getByLabelText(/Title/);
    await user.clear(title);
    await user.type(title, 'New title');
    await user.click(within(form).getByRole('button', { name: 'Add step' }));
    await user.type(within(form).getByLabelText('Written step 2: action'), 'Click Cancel');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(server.sent('PUT', '/api/test-cases/TC_1')).toHaveLength(1));
    expect(server.sent('PUT', '/api/test-cases/TC_1')[0]!.body).toMatchObject({
      testSuiteId: 1,
      title: 'New title',
      module: 'Projects',
      priority: 'High',
      rowVersion: 'v1',
      writtenSteps: [
        { action: 'Click Delete', expected: 'A popup opens' },
        { action: 'Click Cancel' },
      ],
    });
    // Back to reading, with the saved title.
    expect(
      await within(dialog).findByRole('button', { name: 'Edit test case' }),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByText('New title').length).toBeGreaterThan(0);
  });

  it('opens the case while the AI writes its steps, locked, and shows them for review when done', async () => {
    let started = false;
    let checks = 0;
    const job = (status: string) => ({
      id: 'job7',
      status,
      provider: 'fake',
      model: 'm',
      total: 1,
      done: status === 'done' ? 1 : 0,
      startedAt: '2026-01-01T00:00:00Z',
      caseIds: ['TC_2'],
      results: status === 'done' ? [{ caseId: 'TC_2', outcome: 'drafted' }] : [],
    });
    const server = fakeServer({
      'POST /api/ai/generate': () => {
        started = true;
        return { id: 'job7' };
      },
      // Running on the first look, done on the next.
      'GET /api/ai/jobs/job7': () => job(++checks > 1 ? 'done' : 'running'),
      'GET /api/ai/jobs': () => ({
        items: started ? [job(checks > 1 ? 'done' : 'running')] : [],
      }),
      'GET /api/scenarios/TC_2': () => ({
        draft: {
          caseId: 'TC_2',
          scenario: { steps: [{ action: 'assert-text', params: { text: 'Saved' } }] },
          status: 'validated',
          origin: 'ai',
          version: 1,
          updatedAt: '2026-01-01T00:00:00Z',
          issues: [],
          warnings: [],
        },
      }),
    });
    go(`${HOME}/test-cases`);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Actions for TC_2' }));
    await user.click(screen.getByRole('menuitem', { name: 'Write steps with AI' }));
    const dialog = await screen.findByRole('dialog', { name: /TC_2/ });
    expect(server.sent('POST', '/api/ai/generate')[0]!.body).toEqual({ caseIds: ['TC_2'] });
    expect(
      await within(dialog).findByText(/The AI is writing the steps for TC_2/),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Run' })).toBeDisabled();
    // The list holds the case still too, instead of repeating the progress line.
    const row = screen.getByRole('rowheader', { name: 'TC_2' }).closest('tr')!;
    expect(within(row).getByText('AI writing')).toBeInTheDocument();
    expect(screen.queryByText(/The AI is writing steps: /)).not.toBeInTheDocument();

    // When the AI is done, its steps open for review, with the box to ask for changes.
    expect(
      await within(dialog).findByText(/Draft v1 written by AI/, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Improve with AI' })).toBeInTheDocument();
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
    const row = (await screen.findByRole('rowheader', { name: 'TC_2' })).closest('tr')!;
    expect(within(row).getByText('No steps')).toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: 'TC_1' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Select TC_2' }));
    await user.click(
      within(screen.getByRole('region', { name: 'Selected test cases' })).getByRole('button', {
        name: 'Mark ready',
      }),
    );
    await waitFor(() => expect(server.sent('POST', '/api/scenarios/approve')).toHaveLength(1));
    expect(server.sent('POST', '/api/scenarios/approve')[0]!.body).toEqual({ caseIds: ['TC_2'] });
  });

  it('reorders a case from its row menu and saves the list in its new order', async () => {
    const server = fakeServer({
      'POST /api/test-cases/reorder': () => ({ reordered: 2, notFound: 0 }),
    });
    go(`${HOME}/test-cases`);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Actions for TC_2' }));
    expect(screen.getByRole('menuitem', { name: 'Move down' })).toBeDisabled();
    await user.click(screen.getByRole('menuitem', { name: 'Move up' }));
    await waitFor(() => expect(server.sent('POST', '/api/test-cases/reorder')).toHaveLength(1));
    expect(server.sent('POST', '/api/test-cases/reorder')[0]!.body).toEqual({
      ids: ['TC_2', 'TC_1'],
    });
  });

  it('moves a case to a numbered position, which reaches other pages', async () => {
    const server = fakeServer({
      'POST /api/test-cases/reorder': () => ({ reordered: 2, notFound: 0 }),
    });
    go(`${HOME}/test-cases`);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Actions for TC_1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Move to position…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move TC_1' });
    const position = within(dialog).getByRole('spinbutton', { name: /New position/ });
    await user.clear(position);
    await user.type(position, '3');
    expect(within(dialog).getByText('Enter a number from 1 to 2.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Move' })).toBeDisabled();
    await user.clear(position);
    await user.type(position, '2');
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(server.sent('POST', '/api/test-cases/reorder')).toHaveLength(1));
    expect(server.sent('POST', '/api/test-cases/reorder')[0]!.body).toEqual({
      ids: ['TC_2', 'TC_1'],
    });
  });

  it('shows ready cases from the status filter', async () => {
    fakeServer();
    go(`${HOME}/test-cases`);
    const user = userEvent.setup();
    render(<App />);
    const status = await screen.findByRole('radiogroup', { name: 'Filter by automation status' });
    await user.click(within(status).getByRole('radio', { name: /Ready to run/ }));
    expect(await screen.findByRole('rowheader', { name: 'TC_1' })).toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: 'TC_2' })).not.toBeInTheDocument();
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
    expect(await screen.findByRole('rowheader', { name: 'TC_1' })).toBeInTheDocument();
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
    // An example chip says what it is about and fills in its whole prompt.
    const prompt = await screen.findByLabelText(/What should be tested/);
    await user.click(screen.getByRole('button', { name: /Create, edit and delete a draft/ }));
    expect(prompt).toHaveValue(
      'Create, edit and delete a draft project, checking the list after each change.',
    );
    await user.clear(prompt);
    await user.type(prompt, 'Sign in with good and bad passwords');
    await user.click(screen.getByRole('button', { name: 'Generate test cases' }));
    expect(await screen.findByDisplayValue('Wrong password')).toBeInTheDocument();
    expect(server.sent('POST', '/api/ai/cases')).toHaveLength(0);
    // Like a chat, the request becomes a message and the box empties for the next one.
    expect(prompt).toHaveValue('');
    // It is a chat session, named after the request and listed with the other chats.
    expect(
      within(screen.getByRole('navigation', { name: 'Chats' })).getByRole('button', {
        current: true,
      }),
    ).toHaveTextContent('Sign in with good and bad passwords');
    // Where to file them is chosen in the panel, before saving: the header's version by default, and a suite.
    const saveTo = screen.getByRole('group', { name: 'Where to save' });
    expect(within(saveTo).getByLabelText('Version')).toHaveDisplayValue('v1.0');
    await user.selectOptions(within(saveTo).getByLabelText('Test suite'), 'Projects');
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

  it('sends the chosen coverage and shows each proposal’s category and what is not covered', async () => {
    const server = fakeServer({
      'GET /api/ai': () => ({ provider: 'anthropic', ready: true }),
      'POST /api/ai/cases/preview': () => ({
        cases: [
          {
            title: 'Delete a draft',
            category: 'functional',
            steps: ['Click the Delete button'],
            expectedResult: 'Gone',
          },
          {
            title: 'Viewer cannot delete',
            category: 'permission',
            steps: ['Go to the Projects page'],
            expectedResult: 'No Delete button',
          },
          {
            title: 'Delete button looks dangerous',
            category: 'ui',
            manualCheck: true,
            steps: ['Go to the Projects page'],
            expectedResult: 'Red with a bin icon',
          },
        ],
      }),
    });
    go(`${HOME}/ai-assistant`);
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(await screen.findByLabelText('Coverage'), 'thorough');
    await user.type(
      await screen.findByLabelText(/What should be tested/),
      'Delete a draft project',
    );
    await user.click(screen.getByRole('button', { name: 'Generate test cases' }));
    expect(await screen.findByDisplayValue('Viewer cannot delete')).toBeInTheDocument();
    expect(server.sent('POST', '/api/ai/cases/preview')[0]!.body).toMatchObject({
      options: { coverage: 'thorough' },
    });
    const results = screen.getByRole('region', { name: 'Proposed test cases' });
    expect(within(results).getByText('Permission 1')).toBeInTheDocument();
    expect(within(results).getByText('Check by eye')).toBeInTheDocument();
    expect(
      within(results).getByText(/Not covered: Negative, Validation, Boundary/),
    ).toBeInTheDocument();
  });

  it('sends attached files with the request, shows them on the message and clears the box', async () => {
    const server = fakeServer({
      'GET /api/ai': () => ({ provider: 'anthropic', ready: true }),
      'POST /api/ai/cases/preview': () => ({
        cases: [{ title: 'Owner deletes a draft', steps: ['x'], expectedResult: 'Gone' }],
      }),
    });
    go(`${HOME}/ai-assistant`);
    const user = userEvent.setup();
    // StrictMode, as the app runs in development: effects run twice, and the chat must survive it.
    const { container } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    const prompt = await screen.findByLabelText(/What should be tested/);
    const picker = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(picker, new File(['Only owners may delete.'], 'rules.md', { type: '' }));
    const chips = await screen.findByRole('list', { name: 'Files to send' });
    expect(within(chips).getByText('rules.md')).toBeInTheDocument();
    await user.type(prompt, 'Delete a draft project');
    await user.click(screen.getByRole('button', { name: 'Generate test cases' }));
    expect(await screen.findByDisplayValue('Owner deletes a draft')).toBeInTheDocument();
    expect(server.sent('POST', '/api/ai/cases/preview')[0]!.body).toMatchObject({
      attachments: [{ name: 'rules.md', mediaType: 'text/plain', data: 'Only owners may delete.' }],
    });
    // Sent: the box and its file list are empty again, and the message names the file.
    expect(prompt).toHaveValue('');
    expect(screen.queryByRole('list', { name: 'Files to send' })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Chats' })).getByRole('button', {
        current: true,
      }),
    ).toHaveTextContent('Delete a draft project');
    expect(
      within(screen.getByRole('list', { name: 'Attached files' })).getByText(/rules\.md/),
    ).toBeInTheDocument();
  });

  it('keeps unsaved proposals when the page is left and opened again, until they are discarded', async () => {
    fakeServer({
      'GET /api/ai': () => ({ provider: 'anthropic', ready: true }),
      'POST /api/ai/cases/preview': () => ({
        cases: [
          { title: 'Delete a draft', category: 'functional', steps: ['x'], expectedResult: 'Gone' },
          { title: 'Viewer cannot delete', steps: ['y'], expectedResult: 'No button' },
        ],
      }),
    });
    go(`${HOME}/ai-assistant`);
    const user = userEvent.setup();
    render(<App />);
    await user.type(
      await screen.findByLabelText(/What should be tested/),
      'Delete a draft project',
    );
    await user.click(screen.getByRole('button', { name: 'Generate test cases' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Keep "Viewer cannot delete"' }));

    // Leaving the page unmounts the panel; opening it again brings back the conversation, the cards and the ticks.
    cleanup();
    go(`${HOME}/ai-assistant`);
    render(<App />);
    expect(await screen.findByDisplayValue('Viewer cannot delete')).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Chats' })).getByRole('button', {
        current: true,
      }),
    ).toHaveTextContent('Delete a draft project');
    expect(screen.getByLabelText(/What should be tested/)).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: 'Keep "Delete a draft"' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Keep "Viewer cannot delete"' })).not.toBeChecked();

    // Discard forgets the cards for good; the chat itself stays, and "New chat" starts afresh.
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    cleanup();
    go(`${HOME}/ai-assistant`);
    render(<App />);
    expect(await screen.findByRole('navigation', { name: 'Chats' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Proposed test cases' })).not.toBeInTheDocument();
    await user.click(
      within(screen.getByRole('main')).getAllByRole('button', { name: 'New chat' })[0]!,
    );
    expect(
      await screen.findByRole('heading', { name: 'What should be tested?' }),
    ).toBeInTheDocument();
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
    await user.click(await screen.findByRole('button', { name: 'Actions for TC_1' }));
    await user.click(screen.getByRole('menuitem', { name: 'View steps' }));
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
    await user.click(await screen.findByRole('button', { name: 'Actions for TC_1' }));
    await user.click(screen.getByRole('menuitem', { name: 'View steps' }));
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
