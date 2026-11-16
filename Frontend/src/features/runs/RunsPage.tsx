/**
 * Runs page: every run with its pass rate, and the detail of one run (`/run-history/<id>`): each case's result, its
 * steps with timings, the failure with expected/actual, screenshots and traces, reports, and "Explain with AI" for
 * a failed case. While a run is in progress the detail is a live view: progress ring, ticking clocks and a bar split
 * by result, updated as results arrive.
 */
import { useProjectScope } from '../master-data/index.js';
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
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
import { StatusFilter } from '../test-cases/components/StatusFilter.js';
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

/** The current time, ticking every second while `live` (so elapsed clocks move); frozen otherwise. */
function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [live]);
  return now;
}

/** "1:05" or "1:02:05": an elapsed time as a clock. */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

/** How long something took, or has been going on so far while it runs. */
function elapsed(
  start: string | undefined,
  end: string | undefined,
  now: number,
): number | undefined {
  if (!start) return undefined;
  return (end ? Date.parse(end) : now) - Date.parse(start);
}

type CaseFilter = 'all' | 'running' | 'failed' | 'blocked' | 'passed' | 'queued';

/** The parts of the run's progress bar and tiles, in the order they fill. */
const SEGMENTS = [
  { key: 'passed', label: 'Passed', glyph: '✓' },
  { key: 'failed', label: 'Failed', glyph: '✕' },
  { key: 'blocked', label: 'Blocked', glyph: '!' },
  { key: 'running', label: 'Running', glyph: '▶' },
  { key: 'queued', label: 'Queued', glyph: '…' },
] as const;

/**
 * One run, shown live: a progress ring with the share finished, a ticking clock, a tile per result and one bar split
 * by result, then the cases (filterable). A running case shows its own clock and a moving accent. Every status is
 * said in words as well as colour.
 */
function RunDetail({ id }: { id: string }) {
  const toast = useToast();
  const run = useResource(() => fetchRun(id), [id]);
  const [open, setOpen] = useState<string>();
  const [filter, setFilter] = useState<CaseFilter>('all');
  useLive((e) => e.type === 'run' && e.id === id && run.reload());
  const r = run.data;
  const active = r ? ACTIVE.includes(r.status) : false;
  const now = useNow(active);
  if (run.error)
    return (
      <Alert tone="danger" title="This run could not be loaded">
        {run.error}
      </Alert>
    );
  if (!r) return <EmptyState icon="refresh" title="Loading the run…" />;
  const counts = r.summary.counts;
  const total = r.summary.total;
  const done = r.cases.filter((c) => !ACTIVE.includes(c.status)).length;
  const share = total === 0 ? 0 : Math.round((done / total) * 100);
  const runTime = elapsed(r.startedAt, active ? undefined : r.endedAt, now);
  const pctOf = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  // The ring fills by result, so its colours match the bar and the tiles.
  let at = 0;
  const ring = SEGMENTS.filter((s) => s.key !== 'queued')
    .map((s) => {
      const from = at;
      at += pctOf(counts[s.key]);
      return `var(--run-${s.key}) ${from}% ${at}%`;
    })
    .concat(`var(--color-border) ${at}% 100%`)
    .join(', ');
  const matchesFilter = (status: string) =>
    filter === 'all' ||
    status === filter ||
    (filter === 'blocked' && (status === 'skipped' || status === 'cancelled'));
  const shown = r.cases
    .map((c, i) => ({ c, key: `${c.caseId}-${c.account ?? ''}-${i}` }))
    .filter(({ c }) => matchesFilter(c.status));

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

      <section className={styles.hero} data-active={active} aria-label="Run progress">
        <div
          className={styles.ring}
          style={{ background: `conic-gradient(${ring})` }}
          aria-hidden="true"
        >
          <span className={styles.ringInner}>
            <strong>{share}%</strong>
            <span>done</span>
          </span>
        </div>
        <div className={styles.heroMain}>
          <div className={styles.heroHead}>
            {active ? (
              <span className={styles.live}>
                <span className={styles.liveDot} aria-hidden="true" /> Live ·{' '}
                {r.status === 'queued' ? 'waiting to start' : 'running'}
              </span>
            ) : (
              <StatusBadge status={r.status} />
            )}
            {/* Said once per change, not every second: the clock itself is not announced. */}
            <strong aria-live="polite">
              {done} of {total} finished
            </strong>
            {runTime !== undefined && (
              <span className={styles.muted}>
                {active ? 'Elapsed' : 'Took'} <span className={styles.clock}>{clock(runTime)}</span>
              </span>
            )}
            <span className={styles.muted}>Pass rate {pct(r.summary.passRate)}</span>
          </div>
          <div
            className={styles.bar}
            role="progressbar"
            aria-label="Cases finished"
            aria-valuemin={0}
            aria-valuemax={Math.max(total, 1)}
            aria-valuenow={done}
          >
            {SEGMENTS.map((s) =>
              counts[s.key] > 0 ? (
                <span
                  key={s.key}
                  className={styles.segment}
                  data-status={s.key}
                  style={{ width: `${pctOf(counts[s.key])}%` }}
                />
              ) : null,
            )}
          </div>
          <ul className={styles.tiles} aria-label="Results so far">
            {SEGMENTS.map((s) => (
              <li key={s.key} className={styles.tile} data-status={s.key}>
                <span className={styles.tileGlyph} aria-hidden="true">
                  {s.glyph}
                </span>
                <strong>{counts[s.key]}</strong>
                <span>{s.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className={styles.casesHead}>
        <StatusFilter
          label="Show cases"
          active={filter}
          onChange={(f) => setFilter(f as CaseFilter)}
          chips={[
            { id: 'all', label: 'All cases', count: total },
            ...SEGMENTS.filter((s) => counts[s.key] > 0).map((s) => ({
              id: s.key,
              label: s.label,
              count: counts[s.key],
              color: `var(--run-${s.key})`,
            })),
          ]}
        />
      </div>

      <ul className={styles.cases} aria-label="Cases in this run">
        {shown.length === 0 && (
          <li>
            <EmptyState icon="search" title="No case has this result" />
          </li>
        )}
        {shown.map(({ c, key }) => {
          const isOpen = open === key;
          const caseTime = elapsed(c.startedAt, c.endedAt, now);
          const running = c.status === 'running';
          return (
            <li key={key} className={styles.case} data-status={c.status}>
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
                {running ? (
                  <span className={styles.muted}>
                    {plural(c.steps.length, 'step')} done ·{' '}
                    <span className={styles.clock}>{clock(caseTime ?? 0)}</span>
                  </span>
                ) : (
                  <span className={styles.muted}>
                    {c.durationMs !== undefined
                      ? formatDuration(c.durationMs)
                      : caseTime !== undefined
                        ? clock(caseTime)
                        : '—'}
                  </span>
                )}
                <span className={styles.chevron} aria-hidden="true">
                  ›
                </span>
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
                  {c.steps.length === 0 ? (
                    <p className={styles.muted}>
                      {c.status === 'queued' ? 'Waiting for a browser.' : 'No steps recorded.'}
                    </p>
                  ) : (
                    <ol className={styles.steps}>
                      {c.steps.map((s) => (
                        <li key={s.index} data-status={s.status}>
                          <span className={styles.stepNo} aria-hidden="true">
                            {s.index + 1}
                          </span>
                          <StatusBadge status={s.status} />
                          <code>{s.action}</code>
                          <span className={styles.muted}>{formatDuration(s.durationMs)}</span>
                          {s.failure && (
                            <span className={styles.stepFail}>{s.failure.message}</span>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
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
            </li>
          );
        })}
      </ul>
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
