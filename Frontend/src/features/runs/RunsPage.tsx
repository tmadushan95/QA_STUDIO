/**
 * Runs page: every run with its pass rate, and the detail of one run (`/run-history/<id>`): each case's result, its
 * steps with timings, the failure with expected/actual, screenshots and traces, reports, and "Explain with AI" for
 * a failed case. Updates live while a run is in progress.
 */
import { useProjectScope } from '../master-data/index.js';
import { useState } from 'react';
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  ProgressBar,
  StatusBadge,
  useToast,
  type Column,
} from '../../design-system/index.js';
import { errorMessage } from '../../shared/api/http.js';
import { useLive } from '../../shared/api/live.js';
import { useResource } from '../../shared/hooks/useAsync.js';
import { href } from '../../shared/hooks/useRoute.js';
import { formatDate, formatDuration, plural } from '../../shared/lib/format.js';
import { explainFailure, type Diagnosis } from '../ai-assistant/api.js';
import {
  ACTIVE,
  artifactUrl,
  cancelRun,
  fetchRun,
  fetchRuns,
  reportUrl,
  type RunView,
} from './api.js';
import styles from './RunsPage.module.css';

const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);

/** Run history, and the detail of the run in the address. */
export function RunsPage({ runId }: { runId?: string | undefined }) {
  return runId ? <RunDetail id={runId} /> : <RunList />;
}

function RunList() {
  const { project, versionId } = useProjectScope();
  const projectId = project?.id ?? 0;
  const runs = useResource(() => fetchRuns({ projectId, versionId }), [projectId, versionId]);
  useLive((e) => e.type === 'run' && runs.reload());
  const columns: Column<RunView>[] = [
    {
      key: 'when',
      header: 'Started',
      rowHeader: true,
      cell: (r) => <a href={href('runs', r.id)}>{formatDate(r.startedAt ?? r.createdAt)}</a>,
    },
    {
      key: 'status',
      header: 'Status',
      shrink: true,
      cell: (r) => <StatusBadge status={r.status} />,
    },
    { key: 'env', header: 'Environment', cell: (r) => r.environment },
    { key: 'cases', header: 'Cases', shrink: true, align: 'end', cell: (r) => r.summary.total },
    {
      key: 'result',
      header: 'Results',
      cell: (r) => (
        <span className={styles.counts}>
          <span className={styles.pass}>✓ {r.summary.counts.passed}</span>
          <span className={styles.fail}>✕ {r.summary.counts.failed}</span>
          <span className={styles.block}>! {r.summary.counts.blocked}</span>
        </span>
      ),
    },
    {
      key: 'rate',
      header: 'Pass rate',
      shrink: true,
      align: 'end',
      cell: (r) => pct(r.summary.passRate),
    },
  ];
  return (
    <>
      <PageHeader
        title="Run History"
        description="Every run, newest first, with its results, evidence and reports. Start a run from Test Execution."
        actions={
          <a className={styles.linkButton} href={href('execution')}>
            Run tests
          </a>
        }
      />
      {runs.error && <Alert tone="danger">{runs.error}</Alert>}
      <DataTable
        caption="Runs"
        columns={columns}
        rows={runs.data ?? []}
        rowKey={(r) => r.id}
        empty={
          <EmptyState icon="runs" title={runs.loading ? 'Loading runs…' : 'No runs yet'}>
            {runs.loading ? null : 'Select test cases on the Test cases page and press Run.'}
          </EmptyState>
        }
      />
    </>
  );
}

function RunDetail({ id }: { id: string }) {
  const toast = useToast();
  const run = useResource(() => fetchRun(id), [id]);
  const [open, setOpen] = useState<string>();
  useLive((e) => e.type === 'run' && e.id === id && run.reload());
  const r = run.data;
  if (run.error)
    return (
      <Alert tone="danger" title="This run could not be loaded">
        {run.error}
      </Alert>
    );
  if (!r) return <EmptyState icon="refresh" title="Loading the run…" />;
  const active = ACTIVE.includes(r.status);
  const done = r.cases.filter((c) => !ACTIVE.includes(c.status)).length;

  return (
    <>
      <PageHeader
        title={`Run · ${formatDate(r.startedAt ?? r.createdAt)}`}
        description={`${r.environment} · ${r.browser} · ${plural(r.workers, 'browser')} at once`}
        actions={
          <>
            <a className={styles.linkButton} href={href('runs')}>
              All runs
            </a>
            {active ? (
              <Button
                variant="danger"
                onClick={() =>
                  void cancelRun(id).then(
                    () => toast.show('Run cancelled.'),
                    (e: unknown) => toast.show(errorMessage(e), { tone: 'danger' }),
                  )
                }
              >
                Cancel run
              </Button>
            ) : (
              <>
                <a
                  className={styles.linkButton}
                  href={reportUrl(id, 'html')}
                  target="_blank"
                  rel="noreferrer"
                >
                  HTML report
                </a>
                <a className={styles.linkButton} href={reportUrl(id, 'xlsx')} download>
                  Excel report
                </a>
              </>
            )}
          </>
        }
      />
      <div className={styles.summary}>
        <StatusBadge status={r.status} />
        <span>
          {done} / {r.summary.total} finished
        </span>
        <span className={styles.pass}>✓ {r.summary.counts.passed} passed</span>
        <span className={styles.fail}>✕ {r.summary.counts.failed} failed</span>
        <span className={styles.block}>! {r.summary.counts.blocked} blocked</span>
        <span>Pass rate {pct(r.summary.passRate)}</span>
      </div>
      {active && <ProgressBar value={done} max={r.summary.total} label="Run progress" />}
      <div className={styles.cases}>
        {r.cases.map((c, i) => {
          const key = `${c.caseId}-${c.account ?? ''}-${i}`;
          const isOpen = open === key;
          return (
            <Panel key={key} flush>
              <button
                type="button"
                className={styles.caseHead}
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? undefined : key)}
              >
                <StatusBadge status={c.status} />
                <span className={styles.caseId}>{c.caseId}</span>
                <span className={styles.caseTitle}>{c.title}</span>
                {c.account && <span className={styles.muted}>as {c.account}</span>}
                <span className={styles.muted}>{formatDuration(c.durationMs)}</span>
              </button>
              {c.failure && <p className={styles.failure}>{c.failure.message}</p>}
              {isOpen && (
                <div className={styles.caseBody}>
                  {c.failure?.expected !== undefined && (
                    <dl className={styles.expected}>
                      <div>
                        <dt>Expected</dt>
                        <dd>{c.failure.expected}</dd>
                      </div>
                      <div>
                        <dt>Actual</dt>
                        <dd>{c.failure.actual ?? '—'}</dd>
                      </div>
                    </dl>
                  )}
                  <ol className={styles.steps}>
                    {c.steps.map((s) => (
                      <li key={s.index}>
                        <StatusBadge status={s.status} />
                        <code>{s.action}</code>
                        <span className={styles.muted}>{formatDuration(s.durationMs)}</span>
                        {s.failure && <span className={styles.stepFail}>{s.failure.message}</span>}
                      </li>
                    ))}
                  </ol>
                  {c.artifacts.length > 0 && (
                    <div className={styles.artifacts}>
                      {c.artifacts.map((a) =>
                        /\.(png|jpe?g)$/i.test(a) ? (
                          <a key={a} href={artifactUrl(id, a)} target="_blank" rel="noreferrer">
                            <img src={artifactUrl(id, a)} alt={`Screenshot of ${c.caseId}`} />
                          </a>
                        ) : (
                          <a key={a} href={artifactUrl(id, a)} download>
                            {a.split('/').pop()}
                          </a>
                        ),
                      )}
                    </div>
                  )}
                  {c.status === 'failed' && (
                    <Explain runId={id} caseId={c.caseId} account={c.account} />
                  )}
                </div>
              )}
            </Panel>
          );
        })}
      </div>
    </>
  );
}

/** "Explain with AI": whether the failure looks like a test to fix or a defect, with a corrected draft if useful. */
function Explain({
  runId,
  caseId,
  account,
}: {
  runId: string;
  caseId: string;
  account: string | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Diagnosis>();
  const [error, setError] = useState('');
  if (result) {
    const tone =
      result.verdict === 'likely-defect'
        ? 'danger'
        : result.verdict === 'test-fix'
          ? 'info'
          : 'warning';
    const title =
      result.verdict === 'likely-defect'
        ? 'Looks like a defect in the application'
        : result.verdict === 'test-fix'
          ? 'Looks like the test needs updating'
          : 'Not clear from the evidence';
    return (
      <Alert tone={tone} title={title}>
        {result.explanation}
        {result.draft &&
          ` A corrected draft (v${result.draft.version}) is waiting in the case editor for your review.`}
      </Alert>
    );
  }
  return (
    <div className={styles.explain}>
      <Button
        icon="sparkle"
        loading={busy}
        onClick={() => {
          setBusy(true);
          setError('');
          explainFailure(runId, caseId, account).then(setResult, (e: unknown) => {
            setError(errorMessage(e));
            setBusy(false);
          });
        }}
      >
        Explain with AI
      </Button>
      {error && <span className={styles.fail}>{error}</span>}
    </div>
  );
}
