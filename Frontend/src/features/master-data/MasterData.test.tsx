/**
 * UI tests of the Projects & Versions pages and of filing test cases under them: what each form sends, and how refusals from
 * the server reach the person.
 */
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.js';
import { CONNECTION, fakeServer, httpError, PROJECT, SUITE, tc } from '../../test/fake-server.js';

// Pages load on first visit (code splitting); the first visit in a test run can take over a second.
configure({ asyncUtilTimeout: 5000 });

const go = (path: string) => {
  window.history.replaceState(null, '', path);
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

const OTHER_PROJECT = { ...PROJECT, id: 2, code: 'CAPEX', name: 'Capex', testCaseCount: 0 };
const OTHER_SUITE = { ...SUITE, id: 8, projectId: 2, projectName: 'Capex', name: 'Approvals' };

describe('projects page', () => {
  it('lists projects and sends a new one', async () => {
    const server = fakeServer({
      'POST /api/projects': (b) => ({ ...OTHER_PROJECT, ...(b as object) }),
      'PUT /api/project-connections/2': (b) => ({ projectId: 2, ready: true, ...(b as object) }),
    });
    go('/');
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Projects', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('GENERAL')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New project' }));
    const dialog = await screen.findByRole('dialog', { name: 'New project' });
    await user.type(within(dialog).getByLabelText(/Code/), 'CAPEX');
    await user.type(within(dialog).getByLabelText(/Name/), 'Capex');
    await user.selectOptions(within(dialog).getByLabelText(/Environment/), 'uat');
    await user.type(within(dialog).getByLabelText(/Application address/), 'https://capex.test');
    await user.selectOptions(within(dialog).getByLabelText(/Sign-in method/), 'No sign-in');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(server.sent('PUT', '/api/project-connections/2')).toHaveLength(1));
    expect(server.sent('POST', '/api/projects')[0]!.body).toEqual({ code: 'CAPEX', name: 'Capex' });
    expect(server.sent('PUT', '/api/project-connections/2')[0]!.body).toMatchObject({
      envName: 'uat',
      appUrl: 'https://capex.test',
      login: { strategy: 'none' },
    });
    // On to the new project's settings, where its accounts are added.
    await waitFor(() => expect(window.location.pathname).toBe('/project/CAPEX/settings/general'));
  });

  it('does not create a project whose address would be refused', async () => {
    const server = fakeServer({
      'POST /api/project-connections/check': () =>
        httpError(400, 'Refused.', 'invalid-connection', {
          appUrl: 'Refusing to test a production-looking address.',
        }),
    });
    go('/');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'New project' }));
    const dialog = await screen.findByRole('dialog', { name: 'New project' });
    await user.type(within(dialog).getByLabelText(/Code/), 'LIVE');
    await user.type(within(dialog).getByLabelText(/Name/), 'Live');
    await user.selectOptions(within(dialog).getByLabelText(/Environment/), 'qa');
    await user.type(within(dialog).getByLabelText(/Application address/), 'https://prod.example');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/production-looking/)).toBeInTheDocument();
    expect(server.sent('POST', '/api/projects')).toHaveLength(0);
  });

  it('shows on each project where it runs and whether it is ready', async () => {
    fakeServer({
      'GET /api/projects': () => ({ items: [PROJECT, OTHER_PROJECT] }),
    });
    go('/');
    render(<App />);
    expect(await screen.findByText('https://qa.example.com')).toBeInTheDocument();
    expect(await screen.findByText('No application address yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Capex' })).toHaveAttribute(
      'href',
      '/project/CAPEX/dashboard',
    );
    expect(screen.getByText('Needs setup')).toBeInTheDocument();
  });
  it('shows the server’s message beside the field, and keeps what was typed', async () => {
    fakeServer({
      'POST /api/projects': () =>
        httpError(409, 'Already there.', 'duplicate-code', { code: 'This code is already used.' }),
    });
    go('/');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'New project' }));
    const dialog = await screen.findByRole('dialog', { name: 'New project' });
    await user.type(within(dialog).getByLabelText(/Code/), 'GENERAL');
    await user.type(within(dialog).getByLabelText(/Name/), 'Again');
    await user.selectOptions(within(dialog).getByLabelText(/Environment/), 'qa');
    await user.type(within(dialog).getByLabelText(/Application address/), 'https://again.test');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('This code is already used.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Code/)).toHaveValue('GENERAL');
  });

  it('sends the version it opened when saving an edit, so a stale save can be refused', async () => {
    const server = fakeServer({
      'PUT /api/projects/1': (b) => ({ ...PROJECT, ...(b as object) }),
    });
    go('/');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Actions for General' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit General' });
    await user.type(within(dialog).getByLabelText(/Name/), ' apps');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(server.sent('PUT', '/api/projects/1')).toHaveLength(1));
    expect(server.sent('PUT', '/api/projects/1')[0]!.body).toMatchObject({
      name: 'General apps',
      rowVersion: 'AAA=',
    });
  });

  it('warns before a delete the server will refuse, and shows its refusal', async () => {
    fakeServer({
      'DELETE /api/projects/1': () => httpError(409, 'It still has suites.', 'project-has-suites'),
    });
    go('/');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Actions for General' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete General?' });
    expect(within(dialog).getByText(/still has 1 test suite/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete project' }));
    expect(await screen.findByText('It still has suites.')).toBeInTheDocument();
  });
});

describe('a project’s setup page', () => {
  it('saves the project’s own address and sign-in, and field errors stay with the field', async () => {
    const server = fakeServer({
      'PUT /api/project-connections/1': (b) => {
        const body = b as { appUrl: string };
        return body.appUrl.includes('bad')
          ? httpError(400, 'No.', 'invalid-connection', { appUrl: 'Not a good address.' })
          : { projectId: 1, ready: true, ...(b as object) };
      },
    });
    go('/projects/1');
    const user = userEvent.setup();
    render(<App />);
    const address = await screen.findByLabelText(/Application address/);
    await waitFor(() => expect(address).toHaveValue('https://qa.example.com'));
    await user.clear(address);
    await user.type(address, 'https://bad.test');
    await user.click(screen.getByRole('radio', { name: /Login form/ }));
    await user.click(screen.getByRole('button', { name: 'Save project setup' }));
    expect(await screen.findByText('Not a good address.')).toBeInTheDocument();
    expect(address).toHaveValue('https://bad.test');

    await user.clear(address);
    await user.type(address, 'https://capex.test');
    await user.click(screen.getByRole('button', { name: 'Save project setup' }));
    await waitFor(() => expect(server.sent('PUT', '/api/project-connections/1')).toHaveLength(2));
    expect(server.sent('PUT', '/api/project-connections/1')[1]!.body).toMatchObject({
      appUrl: 'https://capex.test',
      login: { strategy: 'login-form' },
    });
  });

  it('lists only this project’s accounts and adds new ones to it', async () => {
    const server = fakeServer({
      'GET /api/project-connections': () => ({
        items: [{ ...CONNECTION, login: { ...CONNECTION.login, strategy: 'login-form' } }],
        allowedEnvs: ['qa'],
      }),
      'GET /api/accounts': () => ({
        items: [
          { id: 'a1', projectId: 1, label: 'Approver', username: 'ap@x', hasPassword: true },
          { id: 'b1', projectId: 2, label: 'Elsewhere', username: 'el@x', hasPassword: true },
        ],
      }),
      'POST /api/accounts': (b) => ({ id: 'n1', hasPassword: true, ...(b as object) }),
    });
    go('/projects/1');
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('Approver')).toBeInTheDocument();
    expect(screen.queryByText('Elsewhere')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add account' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a test account' });
    await user.type(within(dialog).getByLabelText(/^Name/), 'Viewer');
    await user.type(within(dialog).getByLabelText(/User name/), 'vi@x');
    await user.type(within(dialog).getByLabelText(/Password/), 'Secret-1');
    await user.click(within(dialog).getByRole('button', { name: 'Save account' }));
    await waitFor(() => expect(server.sent('POST', '/api/accounts')).toHaveLength(1));
    expect(server.sent('POST', '/api/accounts')[0]!.body).toMatchObject({
      projectId: 1,
      label: 'Viewer',
    });
  });

  it('says so when the project does not exist', async () => {
    fakeServer();
    go('/projects/99');
    render(<App />);
    expect(await screen.findByText('No such project')).toBeInTheDocument();
  });
});

describe('test suites page', () => {
  it('lists the suites of the project in the header and adds new ones to it', async () => {
    const server = fakeServer({
      'GET /api/projects': () => ({ items: [PROJECT, OTHER_PROJECT] }),
      'GET /api/test-suites': () => ({ items: [SUITE, OTHER_SUITE] }),
      'POST /api/test-suites': (b) => ({ ...OTHER_SUITE, ...(b as object) }),
    });
    go('/project/CAPEX/settings/test-suites');
    const user = userEvent.setup();
    render(<App />);
    const table = await screen.findByRole('table', { name: /Test suites/i });
    expect(await within(table).findByText('Approvals')).toBeInTheDocument();
    expect(within(table).queryByText('Projects')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Filter by project')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New test suite' }));
    const dialog = await screen.findByRole('dialog', { name: 'New test suite' });
    // The project is the one in the header, so the form does not ask for it.
    expect(within(dialog).queryByLabelText(/Project/)).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Name/), 'Reports');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(server.sent('POST', '/api/test-suites')).toHaveLength(1));
    expect(server.sent('POST', '/api/test-suites')[0]!.body).toMatchObject({
      projectId: 2,
      name: 'Reports',
    });
  });
});

describe('filing test cases', () => {
  const categorised = [
    tc('TC_1', {
      testSuiteId: 7,
      testSuiteName: 'Projects',
      projectId: 1,
      projectName: 'General',
    } as object),
    tc('TC_2', {
      testSuiteId: 8,
      testSuiteName: 'Approvals',
      projectId: 2,
      projectName: 'Capex',
    } as object),
  ];
  const routes = {
    'GET /api/test-cases': () => ({ total: 2, page: 1, pageSize: 200, items: categorised }),
    'GET /api/scenarios': () => ({
      items: categorised.map((c) => ({ caseId: c.id, state: 'none', hasDraft: false })),
    }),
    'GET /api/projects': () => ({ items: [PROJECT, OTHER_PROJECT] }),
    'GET /api/test-suites': () => ({ items: [SUITE, OTHER_SUITE] }),
  };

  it('shows only the project in the header, and offers only its suites', async () => {
    fakeServer(routes);
    go('/project/GENERAL/test-cases');
    render(<App />);
    expect(await screen.findByRole('button', { name: 'TC_1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'TC_2' })).not.toBeInTheDocument();
    const suites = within(screen.getByLabelText('Test suite')).getAllByRole('option');
    expect(suites.map((o) => o.textContent)).toEqual(['All suites', 'Projects']);
  });

  it('switching project in the header opens the same page in the other project', async () => {
    fakeServer(routes);
    go('/project/GENERAL/test-cases');
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('button', { name: 'TC_1' })).toBeInTheDocument();
    const scope = screen.getByRole('navigation', { name: 'Project and version' });
    await user.click(within(scope).getByRole('button', { name: /Switch project/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Capex' }));
    expect(await screen.findByRole('button', { name: 'TC_2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'TC_1' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/project/CAPEX/test-cases');
  });

  it('files a new case under the chosen suite of the header project', async () => {
    fakeServer({ ...routes, 'GET /api/test-cases/next-id': () => ({ id: 'TC_03' }) });
    go('/project/CAPEX/test-cases');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Create test cases' }));
    const create = await screen.findByRole('dialog', { name: 'Create test cases' });
    expect(within(create).getByText('Capex')).toBeInTheDocument();
    expect(
      within(within(create).getByLabelText('Test suite'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['By module', 'Approvals']);
  });

  it('moves selected cases to another suite', async () => {
    const server = fakeServer({
      ...routes,
      'POST /api/test-cases/move': () => ({ moved: 1, notFound: 0 }),
    });
    go('/project/GENERAL/test-cases');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('checkbox', { name: 'Select TC_1' }));
    const bulk = screen.getByRole('region', { name: 'Selected test cases' });
    await user.click(within(bulk).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move to another suite' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move 1 test case' });
    await user.selectOptions(within(dialog).getByLabelText(/Project/), 'Capex');
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(server.sent('POST', '/api/test-cases/move')).toHaveLength(1));
    expect(server.sent('POST', '/api/test-cases/move')[0]!.body).toEqual({
      ids: ['TC_1'],
      testSuiteId: 8,
    });
    expect(await screen.findByText(/Moved 1 test case to Approvals/)).toBeInTheDocument();
  });

  it('starts on an empty project list when there is no project yet', async () => {
    fakeServer({ 'GET /api/projects': () => ({ items: [] }) });
    go('/test-cases');
    render(<App />);
    expect(await screen.findByText('No projects yet')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
});
