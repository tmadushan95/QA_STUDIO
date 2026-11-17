/**
 * AI Assistant: three jobs, one tab each, in the order people use them.
 *
 * 1. **Generate test cases** — describe a feature (the prompt comes first), review the proposed cases as cards, save
 *    the ones you want into a project › version › suite, and let the AI write their runnable steps.
 * 2. **Write steps for existing cases** — cases that have no steps yet (imported, written by hand) get AI-written steps;
 *    each result says what to do next.
 * 3. **Teach the AI your app** — read pages of the app (read-only) so its steps use your real labels.
 *
 * AI proposes; people decide. Nothing the AI writes runs until a person marks it ready. Provider and key: Settings › AI.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Icon,
  PageHeader,
  Panel,
  ProgressBar,
  Select,
  StatusBadge,
  Tabs,
  tabPanelProps,
  TextArea,
  useToast,
} from '../../design-system/index.js';
import { errorMessage } from '../../shared/api/http.js';
import { useLive } from '../../shared/api/live.js';
import { useResource } from '../../shared/hooks/useAsync.js';
import { href } from '../../shared/hooks/useRoute.js';
import { formatDate, plural } from '../../shared/lib/format.js';
import { fetchSuites, useProjectScope } from '../master-data/index.js';
import { fetchAllCases, fetchScenarioRows } from '../test-cases/api.js';
import {
  MAX_DRAFTS,
  cancelDrafts,
  explore,
  fetchAiStatus,
  fetchDraftJobs,
  fetchExploreDefaults,
  startDrafts,
  type ExploreResult,
} from './api.js';
import { GenerateCasesPanel } from './components/GenerateCasesPanel.js';
import { OUTCOME } from './outcomes.js';
import styles from './AiAssistantPage.module.css';

type TabId = 'generate' | 'steps' | 'learn';

/** The AI Assistant page. */
export function AiAssistantPage() {
  const status = useResource(fetchAiStatus);
  const ready = status.data?.ready === true;
  const [tab, setTab] = useState<TabId>('generate');
  return (
    <div className={styles.page}>
      <PageHeader
        title="AI Assistant"
        description="Describe what to test and get test cases with runnable steps. You review everything before it runs."
        actions={
          <>
            {status.data && (
              <Badge tone={ready ? 'success' : 'warning'} glyph={ready ? '●' : '!'}>
                {ready ? `AI ready · ${status.data.provider}` : 'AI is off'}
              </Badge>
            )}
            <a className="button-link" href={href('settings', 'ai')}>
              AI settings
            </a>
          </>
        }
      />
      {status.data && !ready && (
        <Alert
          tone="warning"
          title="Turn on AI to use the assistant"
          actions={
            <a className="button-link" href={href('settings', 'ai')}>
              Set up AI
            </a>
          }
        >
          {status.data.reason ?? 'Choose a provider and add its API key in Settings › AI.'}
        </Alert>
      )}

      <div>
        <Tabs
          label="AI Assistant"
          idPrefix="ai"
          active={tab}
          onChange={(t) => setTab(t as TabId)}
          tabs={[
            { id: 'generate', label: 'Generate test cases' },
            { id: 'steps', label: 'Write steps for existing cases' },
            { id: 'learn', label: 'Teach the AI your app' },
          ]}
        />
        <div className={styles.tabPanel} {...tabPanelProps(tab, 'ai')}>
          {tab === 'generate' && <Generate status={status.data} />}
          {tab === 'steps' && <DraftSteps enabled={ready} />}
          {tab === 'learn' && <LearnApp enabled={ready} />}
        </div>
      </div>
    </div>
  );
}

/**
 * Tab 1: the shared generator, docked like a chat. New cases go to the project chosen in the header; the version (the
 * header's by default) and the suite ("Suite per module" files each case in a suite named after its module) are
 * picked in the save bar, when saving.
 */
function Generate({ status }: { status: Parameters<typeof GenerateCasesPanel>[0]['status'] }) {
  const { project, versions, versionId: headerVersionId } = useProjectScope();
  const allSuites = useResource(fetchSuites);
  const [suiteId, setSuiteId] = useState(0);
  // Undefined follows the header; choosing here files this batch elsewhere without changing the whole app's scope.
  const [versionId, setVersionId] = useState<number>();
  const version = versions.find((v) => v.id === (versionId ?? headerVersionId));
  const suites = (allSuites.data ?? []).filter((s) => s.projectId === project?.id && s.isActive);
  const suite = suites.find((s) => s.id === suiteId);
  const where = `${project?.name ?? 'this project'}${version ? ` · v${version.name}` : ''}`;
  const targetLabel = suite ? `${where} › ${suite.name}` : `${where}, a suite per module`;

  return (
    <GenerateCasesPanel
      docked
      status={status}
      target={{
        ...(project && { projectId: project.id }),
        ...(suite && { testSuiteId: suite.id }),
        ...(version && { projectVersionId: version.id }),
      }}
      targetLabel={targetLabel}
      targetControls={
        <div className={styles.saveTo}>
          <span className={styles.saveToLabel}>
            <Icon name="folder" size={14} /> Save to {project?.name ?? 'this project'}
          </span>
          <Select
            aria-label="Version"
            value={version?.id ?? 0}
            onChange={(e) => setVersionId(Number(e.target.value))}
          >
            <option value={0}>No version</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Test suite"
            value={suite?.id ?? 0}
            onChange={(e) => setSuiteId(Number(e.target.value))}
          >
            <option value={0}>Suite per module</option>
            {suites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      }
    />
  );
}

/** Tab 2: AI-written steps for cases that have none yet. */
function DraftSteps({ enabled }: { enabled: boolean }) {
  const toast = useToast();
  const jobs = useResource(fetchDraftJobs);
  const candidates = useResource(async () => {
    const [cases, rows] = await Promise.all([fetchAllCases(), fetchScenarioRows()]);
    const withSteps = new Set(rows.filter((r) => r.state !== 'none').map((r) => r.caseId));
    return cases.filter((c) => !withSteps.has(c.id));
  });
  useLive((e) => {
    if (e.type === 'job') {
      jobs.reload();
      if (e.status !== 'running') candidates.reload();
    }
  });
  const running = jobs.data?.find((j) => j.status === 'running');
  const next = (candidates.data ?? []).slice(0, MAX_DRAFTS).map((c) => c.id);

  const start = () =>
    void startDrafts(next).then(
      () => {
        toast.show(`The AI is writing steps for ${plural(next.length, 'case')}.`, { tone: 'info' });
        jobs.reload();
      },
      (e: unknown) => toast.show(errorMessage(e), { tone: 'danger' }),
    );

  return (
    <div className={styles.stack}>
      <section className={styles.callout} aria-label="Cases without steps">
        <div>
          <strong className={styles.big}>{candidates.data ? candidates.data.length : '…'}</strong>
          <span className={styles.muted}>
            test cases have no steps yet
            {candidates.data && candidates.data.length > MAX_DRAFTS
              ? ` · ${MAX_DRAFTS} are done at a time`
              : ''}
          </span>
        </div>
        <Button
          variant="primary"
          icon="sparkle"
          disabled={!enabled || !!running || next.length === 0}
          onClick={start}
        >
          Write steps for {plural(next.length, 'case')}
        </Button>
      </section>

      {(jobs.data ?? []).length === 0 ? (
        <EmptyState icon="sparkle" title="No step writing yet">
          Results show here: steps ready to review, steps that need a fix, and cases that need a
          manual check.
        </EmptyState>
      ) : (
        jobs.data!.slice(0, 3).map((j) => (
          <Panel
            key={j.id}
            title={
              <span className={styles.jobTitle}>
                <StatusBadge
                  status={
                    j.status === 'running' ? 'running' : j.status === 'done' ? 'done' : j.status
                  }
                />
                {j.done} of {j.total} cases
              </span>
            }
            description={`${j.provider} ${j.model} · ${formatDate(j.startedAt)}`}
            actions={
              j.status === 'running' ? (
                <Button size="sm" onClick={() => void cancelDrafts(j.id).then(jobs.reload)}>
                  Stop
                </Button>
              ) : (
                <a className="button-link" href={href('design')}>
                  Review on Test Case Studio
                </a>
              )
            }
          >
            {j.status === 'running' && (
              <ProgressBar value={j.done} max={j.total} label="Step writing progress" />
            )}
            {j.stoppedBecause && <Alert tone="danger">{j.stoppedBecause}</Alert>}
            <ul className={styles.resultGrid}>
              {j.results.map((r) => {
                const o = OUTCOME[r.outcome] ?? { status: r.outcome, label: r.outcome };
                return (
                  <li key={r.caseId} className={styles.resultCard}>
                    <div className={styles.resultHead}>
                      <code>{r.caseId}</code>
                      <StatusBadge status={o.status} label={o.label} />
                    </div>
                    {r.message && <p className={styles.muted}>{r.message}</p>}
                    {o.hint && <p className={styles.hint}>{o.hint}</p>}
                  </li>
                );
              })}
            </ul>
          </Panel>
        ))
      )}
    </div>
  );
}

/** Tab 3: read pages of the app (never changing anything), so the AI's steps use its real labels. */
function LearnApp({ enabled }: { enabled: boolean }) {
  const toast = useToast();
  const [paths, setPaths] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ExploreResult[]>([]);
  useEffect(() => {
    fetchExploreDefaults().then(
      (d) => setPaths(d.defaultPaths.join('\n')),
      () => undefined,
    );
  }, []);
  const read = () => {
    setBusy(true);
    explore(
      paths
        .split('\n')
        .map((p) => p.trim())
        .filter(Boolean),
    ).then(
      (r) => {
        setResults(r);
        setBusy(false);
      },
      (e: unknown) => {
        toast.show(errorMessage(e), { tone: 'danger' });
        setBusy(false);
      },
    );
  };
  return (
    <div className={styles.learn}>
      <Panel
        title="Pages to read"
        description="The AI opens these pages as a signed-in user and reads them. It never clicks or saves anything."
      >
        <div className={styles.stack}>
          <Field label="Page addresses" hint="One path per line, up to 10, such as /projects.">
            {(p) => (
              <TextArea {...p} rows={6} value={paths} onChange={(e) => setPaths(e.target.value)} />
            )}
          </Field>
          <div>
            <Button
              variant="primary"
              icon="search"
              loading={busy}
              disabled={!enabled || !paths.trim()}
              onClick={read}
            >
              Read pages
            </Button>
          </div>
        </div>
      </Panel>
      <Panel title="What the AI learned">
        {results.length === 0 ? (
          <EmptyState
            icon="info"
            title={enabled ? 'Nothing read yet' : 'Available once AI is set up'}
          >
            Pages it reads are remembered and used when it writes steps.
          </EmptyState>
        ) : (
          <ul className={styles.pages}>
            {results.map((r) => (
              <li key={r.path}>
                <code>{r.path}</code>
                {r.ok ? (
                  <Badge tone="success" glyph="✓">
                    {r.title ?? 'Read'}
                  </Badge>
                ) : (
                  <Badge tone="danger" glyph="✕">
                    {r.error ?? 'Failed'}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
