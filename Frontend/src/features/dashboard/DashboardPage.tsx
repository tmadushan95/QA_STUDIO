/**
 * Dashboard: where testing stands, at a glance, and what to do next.
 *
 * - **Health**: the latest pass rate, automation coverage and run activity as headline numbers.
 * - **Results**: the pass-rate trend over recent finished runs and the latest result of every case.
 * - **Library**: test cases by project, version and priority (SQL aggregates from the API) and how many were added
 *   each day, so growth and gaps are visible.
 * - **Act**: coverage by module, recent runs and high-priority failures, each linking to where it can be fixed.
 *
 * Results and coverage come from the API (`/api/dashboard`, read from the database); library counts from `/api/insights`. Either can be
 * missing — the page shows what it has. Numbers follow the definitions listed at the foot of the page.
 */
import { useProjectScope } from '../master-data/index.js';
import { scopeQuery } from '../runs/api.js';
import {
  Alert,
  EmptyState,
  Icon,
  PageHeader,
  Panel,
  StatusBadge,
  type IconName,
} from '../../design-system/index.js';
import { get } from '../../shared/api/http.js';
import { useLive } from '../../shared/api/live.js';
import { useResource } from '../../shared/hooks/useAsync.js';
import { href } from '../../shared/hooks/useRoute.js';
import { formatDate, plural } from '../../shared/lib/format.js';
import { AddedChart, BarList, COLORS, Donut, TrendChart } from './DashboardCharts.js';
import styles from './DashboardPage.module.css';

interface DashboardData {
  totals: { cases: number; withScenario: number; withoutScenario: number };
  latest: {
    passed: number;
    failed: number;
    blocked: number;
    notRun: number;
    passRate: number | null;
  };
  modules: {
    module: string;
    cases: number;
    withScenario: number;
    passed: number;
    failed: number;
    blocked: number;
    notRun: number;
  }[];
  trend: {
    runId: string;
    at: string;
    passed: number;
    failed: number;
    blocked: number;
    total: number;
    passRate: number | null;
  }[];
  recentRuns: {
    id: string;
    status: string;
    at: string;
    environment: string;
    total: number;
    passRate: number | null;
  }[];
  highPriorityFailures: {
    caseId: string;
    title?: string;
    priority?: string;
    runId: string;
    message: string;
  }[];
  definitions: string[];
}

interface CountItem {
  key: string;
  label: string;
  count: number;
}

interface Insights {
  totalCases: number;
  totalProjects: number;
  totalSuites: number;
  totalVersions: number;
  byProject: CountItem[];
  byVersion: CountItem[];
  bySuite: CountItem[];
  byPriority: CountItem[];
  byReadiness: CountItem[];
  addedPerDay: { day: string; count: number }[];
}

const DAYS = 30;
const pct = (r: number | null | undefined) =>
  r === null || r === undefined ? '—' : `${Math.round(r * 100)}%`;

/** Every day of the window, so days with no additions show as zero rather than disappearing. */
function fillDays(points: { day: string; count: number }[]): { day: string; count: number }[] {
  const byDay = new Map(points.map((p) => [p.day, p.count]));
  const out: { day: string; count: number }[] = [];
  const today = new Date();
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i),
    );
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key.slice(5), count: byDay.get(key) ?? 0 });
  }
  return out;
}

/** The dashboard. */
export function DashboardPage() {
  const { project, versionId } = useProjectScope();
  const projectId = project?.id ?? 0;
  const q = scopeQuery({ projectId, versionId });
  const d = useResource(() => get<DashboardData>(`/api/dashboard${q}`), [q]);
  const ins = useResource(
    () => get<Insights>(`/api/insights?days=${DAYS}${q.replace('?', '&')}`).catch(() => undefined),
    [q],
  );
  useLive((e) => {
    if (e.type === 'run' || e.type === 'data') {
      d.reload();
      if (e.type === 'data') ins.reload();
    }
  }, 1000);
  const data = d.data;
  const insights = ins.data;

  const automated =
    data && data.totals.cases > 0 ? data.totals.withScenario / data.totals.cases : null;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const runsThisWeek =
    data?.recentRuns.filter((r) => new Date(r.at).getTime() >= weekAgo).length ?? 0;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Dashboard"
        description="Where testing stands, from the latest result of every test case."
        actions={
          <>
            <a className="button-link" href={href('design')}>
              <Icon name="design" size={16} /> Design tests
            </a>
            <a className={styles.primaryLink} href={href('execution')}>
              <Icon name="play" size={16} /> Run tests
            </a>
          </>
        }
      />

      {d.error && (
        <Alert tone="danger" title="The dashboard could not be loaded">
          {d.error}
        </Alert>
      )}

      {!data ? (
        <EmptyState icon="refresh" title="Loading…" />
      ) : data.totals.cases === 0 ? (
        <Panel>
          <EmptyState
            icon="cases"
            title="No test cases yet"
            action={
              <a className={styles.primaryLink} href={href('design')}>
                Generate test cases
              </a>
            }
          >
            Import an Excel workbook, generate with AI or connect Azure DevOps to start.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <section className={styles.kpis} aria-label="Key numbers">
            <Kpi
              icon="cases"
              label="Test cases"
              value={data.totals.cases}
              hint={
                insights
                  ? `${plural(insights.totalProjects, 'project')} · ${plural(insights.totalVersions, 'version')}`
                  : undefined
              }
              link={href('design')}
            />
            <Kpi
              icon="check"
              label="Automated"
              value={pct(automated)}
              hint={`${data.totals.withScenario} ready · ${data.totals.withoutScenario} to design`}
              link={href('execution')}
              tone="primary"
            />
            <Kpi
              icon="chart"
              label="Pass rate"
              value={pct(data.latest.passRate)}
              hint="passed ÷ (passed + failed)"
              tone={
                data.latest.passRate !== null && data.latest.passRate < 0.8 ? 'danger' : 'success'
              }
            />
            <Kpi
              icon="alert"
              label="Failed"
              value={data.latest.failed}
              hint="latest result"
              tone="danger"
              link={href('execution')}
            />
            <Kpi
              icon="info"
              label="Blocked"
              value={data.latest.blocked}
              hint="missing setup or parameters"
              tone="warning"
            />
            <Kpi
              icon="runs"
              label="Runs this week"
              value={runsThisWeek}
              hint={`${data.recentRuns.length} recent`}
              link={href('runs')}
            />
          </section>

          <div className={styles.row2}>
            <Panel
              title="Pass-rate trend"
              description="Results of the last finished runs; the line is the pass rate."
            >
              {data.trend.length === 0 ? (
                <EmptyState icon="chart" title="No finished runs yet">
                  Run tests to see the trend.
                </EmptyState>
              ) : (
                <TrendChart
                  data={data.trend.map((t) => ({
                    label: formatDate(t.at).split(',')[0] ?? t.at.slice(5, 10),
                    passed: t.passed,
                    failed: t.failed,
                    blocked: t.blocked,
                    passRate: t.passRate,
                  }))}
                />
              )}
            </Panel>
            <Panel title="Latest results" description="Each test case’s most recent result.">
              <Donut
                label="Latest results"
                total={pct(data.latest.passRate)}
                caption="pass rate"
                data={[
                  { name: 'Passed', value: data.latest.passed, color: COLORS.passed },
                  { name: 'Failed', value: data.latest.failed, color: COLORS.failed },
                  { name: 'Blocked', value: data.latest.blocked, color: COLORS.blocked },
                  { name: 'Not run', value: data.latest.notRun, color: COLORS.notRun },
                ]}
              />
            </Panel>
          </div>

          <div className={styles.row3}>
            <Panel title="Automation readiness" description="How many cases can run today.">
              <Donut
                label="Automation readiness"
                total={pct(automated)}
                caption="automated"
                data={[
                  { name: 'Ready to run', value: data.totals.withScenario, color: COLORS.primary },
                  {
                    name: 'Still to design',
                    value: data.totals.withoutScenario,
                    color: COLORS.notRun,
                  },
                ]}
              />
            </Panel>
            <Panel title="Test cases by project">
              {insights && insights.byProject.length > 0 ? (
                <BarList label="Test cases by project" data={insights.byProject} />
              ) : (
                <p className={styles.muted}>Project counts are not available.</p>
              )}
            </Panel>
            <Panel title="Test cases by version">
              {insights && insights.byVersion.length > 0 ? (
                <BarList
                  label="Test cases by version"
                  data={insights.byVersion}
                  color={COLORS.series[3]}
                />
              ) : (
                <EmptyState icon="version" title="No versions yet">
                  <a href={href('project-settings', 'versions')}>Add versions</a> to track cases per
                  release.
                </EmptyState>
              )}
            </Panel>
          </div>

          <div className={styles.row2}>
            <Panel
              title="Coverage by module"
              description="Bar = latest result of each case in the module."
            >
              <ul className={styles.modules}>
                {data.modules.slice(0, 12).map((m) => (
                  <li key={m.module}>
                    <div className={styles.moduleHead}>
                      <span className={styles.moduleName}>{m.module}</span>
                      <span className={styles.muted}>
                        {m.withScenario}/{m.cases} automated
                      </span>
                    </div>
                    <div
                      className={styles.bar}
                      role="img"
                      aria-label={`${m.module}: ${m.passed} passed, ${m.failed} failed, ${m.blocked} blocked, ${m.notRun} not run`}
                    >
                      {(['passed', 'failed', 'blocked', 'notRun'] as const).map((k) =>
                        m[k] > 0 ? (
                          <span key={k} className={styles[k]} style={{ flex: m[k] }} />
                        ) : null,
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <ul className={styles.legend} aria-hidden="true">
                <li>
                  <span className={styles.passed} /> Passed
                </li>
                <li>
                  <span className={styles.failed} /> Failed
                </li>
                <li>
                  <span className={styles.blocked} /> Blocked
                </li>
                <li>
                  <span className={styles.notRun} /> Not run
                </li>
              </ul>
            </Panel>
            <div className={styles.side}>
              <Panel title="By priority">
                {insights && insights.byPriority.length > 0 ? (
                  <BarList
                    label="Test cases by priority"
                    data={insights.byPriority}
                    color={COLORS.series[2]}
                  />
                ) : (
                  <p className={styles.muted}>Priority counts are not available.</p>
                )}
              </Panel>
              <Panel title={`Added in the last ${DAYS} days`}>
                {insights ? (
                  <AddedChart data={fillDays(insights.addedPerDay)} />
                ) : (
                  <p className={styles.muted}>Not available.</p>
                )}
              </Panel>
            </div>
          </div>

          <div className={styles.row2}>
            <Panel title="Recent runs" actions={<a href={href('runs')}>All runs</a>}>
              {data.recentRuns.length === 0 ? (
                <p className={styles.muted}>No runs yet.</p>
              ) : (
                <ul className={styles.list}>
                  {data.recentRuns.slice(0, 6).map((r) => (
                    <li key={r.id}>
                      <StatusBadge status={r.status} />
                      <a href={href('runs', r.id)}>{formatDate(r.at)}</a>
                      <span className={styles.muted}>
                        {r.total} cases · {r.environment}
                      </span>
                      <strong className={styles.rate}>{pct(r.passRate)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="High-priority failures" description="Fix these first.">
              {data.highPriorityFailures.length === 0 ? (
                <p className={styles.muted}>
                  <Icon name="check" size={14} /> None in the latest results.
                </p>
              ) : (
                <ul className={styles.list}>
                  {data.highPriorityFailures.slice(0, 6).map((f) => (
                    <li key={`${f.runId}-${f.caseId}`} className={styles.failure}>
                      <a href={href('runs', f.runId)}>
                        <code>{f.caseId}</code>
                      </a>
                      <span>{f.title}</span>
                      <span className={styles.failMsg}>{f.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <details className={styles.definitions}>
            <summary>How these numbers are calculated</summary>
            <ul>
              {data.definitions.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  hint,
  tone,
  link,
}: {
  icon: IconName;
  label: string;
  value: number | string;
  hint?: string | undefined;
  tone?: 'success' | 'danger' | 'warning' | 'primary';
  link?: string;
}) {
  const body = (
    <>
      <span className={`${styles.kpiIcon} ${tone ? styles[`i-${tone}`] : ''}`}>
        <Icon name={icon} />
      </span>
      <span className={styles.kpiText}>
        <span className={styles.kpiLabel}>{label}</span>
        <span className={tone ? `${styles.kpiValue} ${styles[`t-${tone}`]}` : styles.kpiValue}>
          {value}
        </span>
        {hint && <span className={styles.muted}>{hint}</span>}
      </span>
    </>
  );
  return link ? (
    <a className={styles.kpi} href={link}>
      {body}
    </a>
  ) : (
    <div className={styles.kpi}>{body}</div>
  );
}
