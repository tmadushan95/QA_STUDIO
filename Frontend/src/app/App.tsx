/**
 * App: providers, the access-token gate, the shell (sidebar, header, phone bottom bar) and the page for the current
 * route. Pages are loaded on first visit, so the first screen loads fast.
 *
 * Organised like Azure DevOps: the start page lists projects; opening one scopes the menu, the header's project and
 * version switchers and every page to it until another project or version is chosen.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import {
  Alert,
  AppLayout,
  Badge,
  Button,
  EmptyState,
  Field,
  TextInput,
  ToastProvider,
  type NavItem,
} from '../design-system/index.js';
import { fetchAutomation, type AutomationInfo } from '../shared/api/catalog.js';
import { AUTH_REQUIRED_EVENT, errorMessage, get, send } from '../shared/api/http.js';
import { useLive } from '../shared/api/live.js';
import {
  ProjectScopeProvider,
  ScopeSwitchers,
  useProjectScope,
} from '../features/master-data/index.js';
import { useWorkContext } from '../shared/hooks/useWorkContext.js';
import {
  href,
  hrefIn,
  isProjectPage,
  navigate,
  useLinkNavigation,
  useRoute,
} from '../shared/hooks/useRoute.js';
import styles from './App.module.css';

const DashboardPage = lazy(() =>
  import('../features/dashboard/DashboardPage.js').then((m) => ({ default: m.DashboardPage })),
);
const TestCaseStudioPage = lazy(() =>
  import('../features/test-case-studio/TestCaseStudioPage.js').then((m) => ({
    default: m.TestCaseStudioPage,
  })),
);
const TestExecutionPage = lazy(() =>
  import('../features/test-execution/TestExecutionPage.js').then((m) => ({
    default: m.TestExecutionPage,
  })),
);
const RunsPage = lazy(() =>
  import('../features/runs/RunsPage.js').then((m) => ({ default: m.RunsPage })),
);
const AiAssistantPage = lazy(() =>
  import('../features/ai-assistant/AiAssistantPage.js').then((m) => ({
    default: m.AiAssistantPage,
  })),
);
const AzureDevOpsPage = lazy(() =>
  import('../features/azure-devops/AzureDevOpsPage.js').then((m) => ({
    default: m.AzureDevOpsPage,
  })),
);
const ProjectsSection = lazy(() =>
  import('../features/master-data/ProjectsSection.js').then((m) => ({
    default: m.ProjectsSection,
  })),
);
const ProjectSettingsPage = lazy(() =>
  import('../features/master-data/ProjectSettingsPage.js').then((m) => ({
    default: m.ProjectSettingsPage,
  })),
);
const SettingsPage = lazy(() =>
  import('../features/settings/SettingsPage.js').then((m) => ({ default: m.SettingsPage })),
);
// Loaded after the first screen; it renders nothing until voice is turned on in Settings › Voice.
const VoiceControl = lazy(() =>
  import('../features/voice/VoiceControl.js').then((m) => ({ default: m.VoiceControl })),
);

/** Organization level, before a project is chosen: the project list and how QA Studio itself runs. */
const ORG_NAV: NavItem[] = [
  { id: 'home', label: 'Projects', icon: 'folder', href: href('home'), primary: true },
  {
    id: 'settings',
    label: 'Organization settings',
    icon: 'settings',
    href: href('settings'),
    group: 'Administration',
    primary: true,
  },
];

/**
 * Inside a project, in the order testers work: see where things stand, design the tests, execute them and read the
 * results, connect other tools, then the project's settings at the foot of the sidebar. `primary` items are the
 * phone's bottom bar.
 */
function projectNav(code: string): NavItem[] {
  const to = (page: string) => hrefIn(code, page);
  return [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: 'dashboard',
      href: to('dashboard'),
      group: 'Overview',
      primary: true,
    },
    {
      id: 'design',
      label: 'Test Case Studio',
      icon: 'design',
      href: to('design'),
      group: 'Test design',
      primary: true,
    },
    { id: 'ai', label: 'AI Assistant', icon: 'sparkle', href: to('ai'), group: 'Test design' },
    {
      id: 'execution',
      label: 'Test Execution',
      icon: 'execute',
      href: to('execution'),
      group: 'Execution',
      primary: true,
    },
    {
      id: 'runs',
      label: 'Run History',
      icon: 'runs',
      href: to('runs'),
      group: 'Execution',
      primary: true,
    },
    {
      id: 'azure-devops',
      label: 'Azure DevOps',
      icon: 'cloud',
      href: to('azure-devops'),
      group: 'Integrations',
    },
    {
      id: 'project-settings',
      label: 'Project settings',
      icon: 'settings',
      href: to('project-settings'),
      group: 'Administration',
    },
  ];
}

/** Worker features this web app depends on (see WORKER_CAPABILITIES in the worker's app.ts). */
const REQUIRED_CAPABILITIES = ['api-parameters', 'azure-devops', 'custom-steps'];

/** The whole application: toasts, the access-token gate, the project scope, then the shell. */
export function App() {
  return (
    <ToastProvider>
      <AccessGate>
        <ProjectScopeProvider>
          <Shell />
        </ProjectScopeProvider>
      </AccessGate>
    </ToastProvider>
  );
}

function Shell() {
  const route = useRoute();
  const scope = useProjectScope();
  const [ctx] = useWorkContext();
  const [info, setInfo] = useState<AutomationInfo>();
  const live = useLive(() => fetchAutomation().then(setInfo, () => undefined), 2000);
  useEffect(() => {
    fetchAutomation().then(setInfo, () => undefined);
  }, []);
  useLinkNavigation();
  // A worker older than this web app lacks routes it relies on; say so once, here, rather than failing page by page.
  const outdated = info ? REQUIRED_CAPABILITIES.filter((c) => !info.capabilities?.includes(c)) : [];

  const inProject = isProjectPage(route.page);
  const { project } = scope;
  const nav = project ? projectNav(project.code) : ORG_NAV;
  const active = nav.some((n) => n.id === route.page) ? route.page : (nav[0]?.id ?? 'home');

  // A project page reached without a project (an old link such as /test-cases) opens in the last project used, or
  // the only one; otherwise the project list, where one is chosen. Unknown organization pages also go home.
  useEffect(() => {
    if (scope.loading) return;
    if (inProject && !route.project) {
      const last =
        scope.projects.find((p) => p.id === ctx.projectId) ??
        (scope.projects.length === 1 ? scope.projects[0] : undefined);
      navigate(last ? hrefIn(last.code, route.page, route.sub, route.detail) : '/', true);
    } else if (!inProject && route.page !== 'home' && route.page !== 'settings') {
      navigate('/', true);
    }
  }, [scope.loading, route.page, route.project]);

  // Name the page and the project in the window title, so tabs and history entries are distinguishable.
  const pageLabel = nav.find((n) => n.id === active)?.label ?? 'QA Studio';
  useEffect(() => {
    document.title = [pageLabel, project?.name, 'QA Studio'].filter(Boolean).join(' · ');
  }, [pageLabel, project?.name]);

  const missingProject = Boolean(route.project) && !scope.loading && !project;

  return (
    <AppLayout
      product="QA Studio"
      tagline={project ? project.name : 'Test automation'}
      homeHref={href('home')}
      nav={nav}
      bottomGroups={['Administration']}
      active={active}
      scope={project ? <ScopeSwitchers /> : undefined}
      topBar={
        <>
          {info && (
            // On phones the header holds the project and version switchers; readiness shows on the pages.
            <span className={project ? styles.status : undefined}>
              {info.runsAvailable ? (
                <Badge tone="success" glyph="●">
                  {info.environment ?? 'Ready'}
                </Badge>
              ) : (
                <a
                  href={project ? href('project-settings', 'general') : href('home')}
                  className={styles.setup}
                >
                  <Badge tone="warning" glyph="!">
                    Set up a project
                  </Badge>
                </a>
              )}
            </span>
          )}
          {info?.capabilities?.includes('voice') && (
            <Suspense fallback={null}>
              <VoiceControl />
            </Suspense>
          )}
          <span className={styles.live} title={live ? 'Live updates on' : 'Reconnecting…'}>
            <span className={live ? styles.dotOn : styles.dotOff} aria-hidden="true" />
            <span className={styles.liveText}>{live ? 'Live' : 'Offline'}</span>
          </span>
        </>
      }
    >
      {outdated.length > 0 && (
        <div className={styles.banner}>
          <Alert tone="warning" title="The QA Studio worker is out of date">
            It was started before the last update, so some features will not work (
            {outdated.join(', ')}). Stop it and start it again with <code>npm run worker</code> in
            Backend/Worker (or <code>npm start</code> for the API and the worker together), then
            reload this page.
          </Alert>
        </div>
      )}
      <Suspense fallback={<EmptyState icon="refresh" title="Loading…" />}>
        {missingProject && (
          <EmptyState
            icon="folder"
            title="No such project"
            action={
              <a className="button-link" href={href('home')}>
                See all projects
              </a>
            }
          >
            “{route.project}” may have been renamed or deleted.
          </EmptyState>
        )}
        {inProject && !project && !missingProject && (
          <EmptyState icon="refresh" title="Opening the project…" />
        )}
        {!project && route.page === 'home' && <ProjectsSection />}
        {!project && route.page === 'settings' && <SettingsPage section={route.sub} />}
        {project && <ProjectPage key={project.id} page={active} sub={route.sub} />}
      </Suspense>
    </AppLayout>
  );
}

/** The page of the current project. Keyed by project, so switching project starts every page afresh. */
function ProjectPage({ page, sub }: Readonly<{ page: string; sub: string | undefined }>) {
  switch (page) {
    case 'design':
      return <TestCaseStudioPage />;
    case 'ai':
      return <AiAssistantPage />;
    case 'execution':
      return <TestExecutionPage />;
    case 'runs':
      return <RunsPage runId={sub} />;
    case 'azure-devops':
      return <AzureDevOpsPage />;
    case 'project-settings':
      return <ProjectSettingsPage section={sub} />;
    default:
      return <DashboardPage />;
  }
}

/**
 * When the server is protected by an access token, ask for it before showing anything. The token is sent once and
 * kept by the server as an HTTP-only cookie; the page never stores it.
 */
function AccessGate({ children }: { children: JSX.Element }) {
  const [state, setState] = useState<'checking' | 'open' | 'locked'>('checking');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get<{ required?: boolean; authenticated?: boolean }>('/api/auth/status').then(
      (s) => setState(s?.required === true && s.authenticated === false ? 'locked' : 'open'),
      () => setState('open'),
    );
    const lock = () => setState('locked');
    window.addEventListener(AUTH_REQUIRED_EVENT, lock);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, lock);
  }, []);
  if (state === 'checking') return <EmptyState icon="refresh" title="Loading…" />;
  if (state === 'open') return children;
  return (
    <main className={styles.gate}>
      <form
        className={styles.gateCard}
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          send('/api/auth/login', { token }).then(
            () => {
              setState('open');
              setBusy(false);
            },
            (err: unknown) => {
              setError(errorMessage(err));
              setBusy(false);
            },
          );
        }}
      >
        <h1>QA Studio</h1>
        <p className={styles.muted}>
          This server is protected. Enter the access token from its .env file.
        </p>
        <Field label="Access token" error={error}>
          {(p) => (
            <TextInput
              {...p}
              type="password"
              autoComplete="current-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" loading={busy} disabled={!token}>
          Continue
        </Button>
      </form>
    </main>
  );
}
