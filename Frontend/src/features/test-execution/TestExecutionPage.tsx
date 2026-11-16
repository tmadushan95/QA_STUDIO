/**
 * Test Execution: run the test cases that are ready and follow the results.
 *
 * Only cases marked ready on Test Case Studio are listed. Before a run, their parameters can be checked and filled
 * (by hand or automatically); a case missing a value would be blocked. A run can use one user, or several users at
 * once ("Concurrent users") to check what happens when people work in parallel: tick cases, then use the bar that
 * appears. A live strip shows the run in progress; full results are in Run History.
 *
 * The list gets the page: filters sit in one slim row (search opens from a button) and rows are compact, so about ten
 * cases show without scrolling.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  Menu,
  PageHeader,
  ProgressBar,
  SearchBox,
  Select,
  StatusBadge,
  useToast,
  type Column,
} from '../../design-system/index.js';
import { errorMessage } from '../../shared/api/http.js';
import { useDebounced } from '../../shared/hooks/useAsync.js';
import { href, navigate } from '../../shared/hooks/useRoute.js';
import { plural } from '../../shared/lib/format.js';
import { StartRunDialog } from '../runs/components/StartRunDialog.js';
import { ACTIVE } from '../runs/api.js';
import { autoConfigure, type TestCase } from '../test-cases/api.js';
import { CaseEditorDialog } from '../test-cases/components/CaseEditorDialog.js';
import { CaseTitle, LastResult, ParamsCell } from '../test-cases/components/CaseListParts.js';
import { ParametersDialog } from '../test-cases/components/ParametersDialog.js';
import { useProjectScope } from '../master-data/index.js';
import { StatusFilter } from '../test-cases/components/StatusFilter.js';
import { matches, useCaseLibrary, type CaseRow } from '../test-cases/useCaseLibrary.js';
import list from '../test-cases/components/CaseList.module.css';
import styles from './TestExecutionPage.module.css';

type ResultFilter = '' | 'notRun' | 'passed' | 'failed' | 'missing';

const PAGE_SIZE = 25;

/** The Test Execution page. */
export function TestExecutionPage() {
  const toast = useToast();
  const lib = useCaseLibrary();
  const { project, versionId } = useProjectScope();
  const projectId = project?.id ?? 0;
  const [suiteId, setSuiteId] = useState(0);
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  const [result, setResult] = useState<ResultFilter>('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState<{ ids: string[]; concurrent: boolean }>();
  const [editing, setEditing] = useState<TestCase>();
  const [params, setParams] = useState<TestCase>();
  const [busy, setBusy] = useState(false);
  /** The search box opens from its button and folds away again once it is left empty. */
  const [searching, setSearching] = useState(false);
  const searchWrap = useRef<HTMLDivElement>(null);
  const searchOpen = searching || q !== '';
  useEffect(() => {
    if (searching) searchWrap.current?.querySelector('input')?.focus();
  }, [searching]);

  const filter = { projectId: projectId, versionId: versionId, suiteId, query };
  const ready = useMemo(
    () => lib.rows.filter((r) => r.state === 'approved' && matches(r, filter)),
    [lib.rows, projectId, versionId, suiteId, query],
  );
  const lastStatus = (r: CaseRow) => r.last?.result.status;
  const rows = ready.filter((r) => {
    if (result === 'notRun') return !r.last;
    if (result === 'passed') return lastStatus(r) === 'passed';
    if (result === 'failed') return lastStatus(r) === 'failed' || lastStatus(r) === 'blocked';
    if (result === 'missing') return r.missing.length > 0;
    return true;
  });
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const ids = [...selected];

  const active = lib.runs.find((r) => ACTIVE.includes(r.status));
  const missingCount = ready.filter((r) => r.missing.length > 0).length;

  const fill = async (list: string[]) => {
    setBusy(true);
    try {
      const r = await autoConfigure(list);
      toast.show(
        `Filled ${plural(r.filled, 'value')} in ${plural(r.configured, 'case')}.${r.stillMissing.length ? ` ${plural(r.stillMissing.length, 'case')} still miss a value — open its Parameters.` : ''}`,
      );
      lib.reload();
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<CaseRow>[] = [
    {
      key: 'id',
      header: 'ID',
      rowHeader: true,
      shrink: true,
      // A case opens from its row menu ("View steps"), so the ID is plain text.
      cell: (r) => <span className={list.caseId}>{r.tc.id}</span>,
    },
    { key: 'title', header: 'Title', cell: (r) => <CaseTitle row={r} /> },
    { key: 'params', header: 'Parameters', shrink: true, cell: (r) => <ParamsCell row={r} /> },
    { key: 'last', header: 'Last result', shrink: true, cell: (r) => <LastResult row={r} /> },
    {
      key: 'runs',
      header: 'Runs',
      shrink: true,
      align: 'end',
      cell: (r) => (r.runs ? r.runs : '—'),
    },
    {
      key: 'actions',
      header: <span className="visually-hidden">Actions</span>,
      label: '',
      shrink: true,
      cell: (r) => (
        <span className={list.rowActions}>
          {selected.size === 0 && (
            <Button
              size="sm"
              icon="play"
              aria-label={`Run ${r.tc.id}`}
              onClick={() => setRunning({ ids: [r.tc.id], concurrent: false })}
            >
              Run
            </Button>
          )}
          <Menu
            label={`Actions for ${r.tc.id}`}
            items={[
              { label: 'Parameters', icon: 'sliders', onSelect: () => setParams(r.tc) },
              {
                label: 'Run as concurrent users',
                icon: 'users',
                onSelect: () => setRunning({ ids: [r.tc.id], concurrent: true }),
              },
              { label: 'View steps', icon: 'design', onSelect: () => setEditing(r.tc) },
            ]}
          />
        </span>
      ),
    },
  ];

  return (
    <div className={list.stack}>
      <PageHeader
        title="Test Execution"
        description="Run ready test cases and follow the results live. Tick cases to run several at once."
      />

      {active && (
        <section className={styles.live} aria-label="Run in progress">
          <div className={styles.liveHead}>
            <StatusBadge status={active.status} />
            <strong>
              {active.summary.counts.passed +
                active.summary.counts.failed +
                active.summary.counts.blocked}{' '}
              of {active.summary.total} done
            </strong>
            <a href={href('runs', active.id)}>Open the run</a>
          </div>
          <ProgressBar
            value={
              active.summary.total - active.summary.counts.queued - active.summary.counts.running
            }
            max={Math.max(active.summary.total, 1)}
            label="Run progress"
          />
        </section>
      )}

      <div className={list.stack}>
        <div className={styles.filters}>
          <div className={styles.filterRow}>
            <StatusFilter
              label="Filter by last result"
              active={result || 'all'}
              onChange={(id) => {
                setResult(id === 'all' ? '' : (id as ResultFilter));
                setPage(1);
              }}
              chips={[
                { id: 'all', label: 'All ready', count: ready.length },
                {
                  id: 'notRun',
                  label: 'Not run yet',
                  count: ready.filter((r) => !r.last).length,
                  color: 'var(--color-text-muted)',
                },
                {
                  id: 'passed',
                  label: 'Passed',
                  count: ready.filter((r) => lastStatus(r) === 'passed').length,
                  color: 'var(--color-success)',
                },
                {
                  id: 'failed',
                  label: 'Failed or blocked',
                  count: ready.filter(
                    (r) => lastStatus(r) === 'failed' || lastStatus(r) === 'blocked',
                  ).length,
                  color: 'var(--color-danger)',
                },
                {
                  id: 'missing',
                  label: 'Missing parameters',
                  count: missingCount,
                  color: 'var(--color-warning)',
                },
              ]}
            />
            <div className={styles.toolbar}>
              {/* In the same row as the filters, so it costs the list no height. */}
              {missingCount > 0 && selected.size === 0 && (
                <span className={styles.notice}>
                  <span className={list.sub}>
                    {plural(missingCount, 'case')} would be blocked by a missing parameter.
                  </span>
                  <Button
                    size="sm"
                    icon="sliders"
                    loading={busy}
                    onClick={() =>
                      void fill(ready.filter((r) => r.missing.length > 0).map((r) => r.tc.id))
                    }
                  >
                    Auto-fill parameters
                  </Button>
                </span>
              )}
              {searchOpen ? (
                <div
                  ref={searchWrap}
                  className={styles.search}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null) && q === '')
                      setSearching(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && q === '') setSearching(false);
                  }}
                >
                  <SearchBox
                    label="Search test cases"
                    placeholder="Search by ID, title or module"
                    value={q}
                    onChange={(v) => {
                      setQ(v);
                      setPage(1);
                    }}
                  />
                </div>
              ) : (
                <Button icon="search" onClick={() => setSearching(true)}>
                  Search
                </Button>
              )}
              <Select
                aria-label="Test suite"
                className={styles.suite}
                value={suiteId}
                onChange={(e) => {
                  setSuiteId(Number(e.target.value));
                  setPage(1);
                }}
              >
                <option value={0}>All suites</option>
                {lib.suites
                  .filter((x) => x.projectId === projectId)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </Select>
            </div>
          </div>
          {selected.size > 0 && (
            <div className={list.bulk} role="region" aria-label="Selected test cases">
              <strong>{selected.size} selected</strong>
              <Button
                size="sm"
                variant="primary"
                icon="play"
                onClick={() => setRunning({ ids, concurrent: false })}
              >
                Run {selected.size}
              </Button>
              <Button size="sm" icon="users" onClick={() => setRunning({ ids, concurrent: true })}>
                Concurrent run
              </Button>
              <Button size="sm" icon="sliders" loading={busy} onClick={() => void fill(ids)}>
                Auto-fill parameters
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear selection
              </Button>
            </div>
          )}
        </div>

        {lib.error && (
          <Alert tone="danger" title="The test cases could not be loaded">
            {lib.error}
          </Alert>
        )}

        <div className={list.dense}>
          <DataTable
            caption="Test cases ready to run"
            columns={columns}
            rows={pageRows}
            rowKey={(r) => r.tc.id}
            selection={{ selected, onChange: setSelected, label: (r) => `Select ${r.tc.id}` }}
            paging={{ page, pageSize: PAGE_SIZE, total: rows.length, onPage: setPage }}
            empty={
              lib.loading ? (
                <EmptyState icon="refresh" title="Loading test cases…" />
              ) : ready.length === 0 ? (
                <EmptyState
                  icon="execute"
                  title="No test case is ready to run here"
                  action={
                    <a className="button-link" href={href('design')}>
                      Open Test Case Studio
                    </a>
                  }
                >
                  Mark cases ready on Test Case Studio, or choose another project or version.
                </EmptyState>
              ) : (
                <EmptyState icon="search" title="No test case matches this filter" />
              )
            }
          />
        </div>
      </div>

      {running && (
        <StartRunDialog
          caseIds={running.ids}
          concurrent={running.concurrent}
          onClose={() => setRunning(undefined)}
          onStarted={(run) => {
            setRunning(undefined);
            setSelected(new Set());
            navigate(href('runs', run.id));
          }}
        />
      )}
      {editing && (
        <CaseEditorDialog
          testCase={editing}
          onClose={() => setEditing(undefined)}
          onChanged={lib.reload}
        />
      )}
      {params && (
        <ParametersDialog
          caseId={params.id}
          title={params.title}
          onClose={() => setParams(undefined)}
          onSaved={lib.reload}
        />
      )}
    </div>
  );
}
