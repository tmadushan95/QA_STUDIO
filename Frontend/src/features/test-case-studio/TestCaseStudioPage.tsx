/**
 * Test Case Studio: create, review and approve the test cases of one project version.
 *
 * Layout, top to bottom, kept short so the list is reachable without scrolling past controls:
 * - Header with the single primary action, **Create test cases** (Excel, AI, by hand or Azure DevOps — always into the
 *   chosen project and version).
 * - **Scope**: project › version (with "New version" right there).
 * - **Status chips** with counts (All, No steps, Needs fixing, To approve, Ready) — one row that scrolls on phones.
 * - A compact **toolbar** (search, suite, more filters) that sticks while the list scrolls and turns into the **bulk
 *   actions** bar when cases are selected, so the two never compete for space.
 * - A one-line **activity** strip while imported or generated cases are being turned into steps.
 * - The list. Every row has the same ⋯ menu: edit steps, parameters, history, write steps, set version, move, delete.
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  Menu,
  PageHeader,
  Panel,
  SearchBox,
  Select,
  StatusBadge,
  StickyBar,
  useToast,
  type Column,
} from '../../design-system/index.js';
import { errorMessage } from '../../shared/api/http.js';
import { useLive } from '../../shared/api/live.js';
import { useDebounced, useResource } from '../../shared/hooks/useAsync.js';
import { href } from '../../shared/hooks/useRoute.js';
import { plural } from '../../shared/lib/format.js';
import { fetchAiStatus, fetchDraftJobs } from '../ai-assistant/api.js';
import {
  ConversionCard,
  ImportDialog,
  fetchConversions,
  type FilingTarget,
} from '../import/index.js';
import {
  approveMany,
  autoConfigure,
  convertCases,
  deleteCases,
  draftWithAi,
  type TestCase,
} from '../test-cases/api.js';
import { AssignVersionDialog } from '../test-cases/components/AssignVersionDialog.js';
import { CaseEditorDialog } from '../test-cases/components/CaseEditorDialog.js';
import { CaseTitle, ParamsCell } from '../test-cases/components/CaseListParts.js';
import { MoveCasesDialog } from '../test-cases/components/MoveCasesDialog.js';
import { NewCaseDialog } from '../test-cases/components/NewCaseDialog.js';
import { ParametersDialog } from '../test-cases/components/ParametersDialog.js';
import { useProjectScope } from '../master-data/index.js';
import { StatusFilter } from '../test-cases/components/StatusFilter.js';
import { matches, useCaseLibrary, type CaseRow } from '../test-cases/useCaseLibrary.js';
import list from '../test-cases/components/CaseList.module.css';
import { CreateCasesDialog, type Destination } from './components/CreateCasesDialog.js';
import styles from './TestCaseStudioPage.module.css';

type StateFilter = 'all' | 'none' | 'draft' | 'validated' | 'approved';
type EditorTab = 'steps' | 'history';

const PAGE_SIZE = 25;
/** The AI writes steps for at most this many cases per request (the server's limit). */
const MAX_AI = 25;

/** The Test Case Studio page. */
export function TestCaseStudioPage() {
  const toast = useToast();
  const lib = useCaseLibrary();
  const conversions = useResource(fetchConversions);
  const aiJobs = useResource(fetchDraftJobs);
  const ai = useResource(() => fetchAiStatus().catch(() => undefined));
  useLive((e) => {
    if (e.type === 'job') {
      conversions.reload();
      aiJobs.reload();
    }
  });

  const { project, versionId } = useProjectScope();
  const projectId = project?.id ?? 0;
  const [state, setState] = useState<StateFilter>('all');
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  const [suiteId, setSuiteId] = useState(0);
  const [moreFilters, setMoreFilters] = useState(false);
  const [priority, setPriority] = useState('');
  const [module, setModule] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');

  const [editing, setEditing] = useState<{ tc: TestCase; tab: EditorTab }>();
  const [params, setParams] = useState<TestCase>();
  const [creating, setCreating] = useState(false);
  const [importTarget, setImportTarget] = useState<FilingTarget>();
  const [manual, setManual] = useState<Destination>();
  const [moving, setMoving] = useState<string[]>();
  const [versioning, setVersioning] = useState<string[]>();
  const [confirmDelete, setConfirmDelete] = useState<string[]>();
  const [activityOpen, setActivityOpen] = useState(false);

  const suites = lib.suites.filter((s) => s.projectId === projectId);
  const scoped = useMemo(
    () =>
      lib.rows.filter((r) =>
        matches(r, { projectId: projectId, versionId: versionId, suiteId, query }),
      ),
    [lib.rows, projectId, versionId, suiteId, query],
  );
  const priorities = [
    ...new Set(scoped.map((r) => r.tc.priority).filter(Boolean)),
  ].sort() as string[];
  const modules = [...new Set(scoped.map((r) => r.tc.module).filter(Boolean))].sort() as string[];
  const filtered = scoped.filter(
    (r) =>
      (state === 'all' || r.state === state) &&
      (!priority || r.tc.priority === priority) &&
      (!module || r.tc.module === module) &&
      (!onlyMissing || r.missing.length > 0),
  );
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const count = (s: StateFilter) =>
    s === 'all' ? scoped.length : scoped.filter((r) => r.state === s).length;
  const extraFilters = [priority, module, onlyMissing ? 'x' : ''].filter(Boolean).length;
  const ids = [...selected];
  const reset = () => setPage(1);

  const runningConversion = (conversions.data ?? []).find((j) => j.status === 'running');
  const runningAi = (aiJobs.data ?? []).find((j) => j.status === 'running');

  const act = async (label: string, work: () => Promise<string>) => {
    setBusy(label);
    try {
      toast.show(await work());
      setSelected(new Set());
      lib.reload();
      conversions.reload();
      aiJobs.reload();
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setBusy('');
    }
  };
  const markReady = (list: string[]) =>
    act('ready', async () => {
      const r = await approveMany(list);
      return `${plural(r.approved, 'case')} marked ready to run.${r.skipped.length ? ` ${plural(r.skipped.length, 'case')} still need their steps fixed.` : ''}`;
    });
  const convert = (list: string[]) =>
    act('convert', async () => {
      await convertCases(list);
      return `Turning the written steps of ${plural(list.length, 'case')} into runnable steps.`;
    });
  const writeWithAi = (list: string[]) =>
    act('ai', async () => {
      await draftWithAi(list.slice(0, MAX_AI));
      return `The AI is writing steps for ${plural(Math.min(list.length, MAX_AI), 'case')}.`;
    });
  const autoFill = (list: string[]) =>
    act('params', async () => {
      const r = await autoConfigure(list);
      return `Filled ${plural(r.filled, 'value')} in ${plural(r.configured, 'case')}.${r.stillMissing.length ? ` ${plural(r.stillMissing.length, 'case')} still miss a value.` : ''}`;
    });
  const remove = (list: string[]) =>
    act('delete', async () => {
      const r = await deleteCases(list);
      setConfirmDelete(undefined);
      return `Deleted ${plural(r.deleted, 'test case')}.`;
    });

  const rowMenu = (r: CaseRow) => [
    {
      label: 'Edit steps',
      icon: 'design' as const,
      onSelect: () => setEditing({ tc: r.tc, tab: 'steps' }),
    },
    { label: 'Parameters', icon: 'sliders' as const, onSelect: () => setParams(r.tc) },
    {
      label: 'History',
      icon: 'history' as const,
      onSelect: () => setEditing({ tc: r.tc, tab: 'history' }),
    },
    {
      label: 'Write steps from text',
      icon: 'refresh' as const,
      onSelect: () => void convert([r.tc.id]),
    },
    {
      label: 'Write steps with AI',
      icon: 'sparkle' as const,
      onSelect: () => void writeWithAi([r.tc.id]),
    },
    { label: 'Set version', icon: 'version' as const, onSelect: () => setVersioning([r.tc.id]) },
    {
      label: 'Move to another suite',
      icon: 'folder' as const,
      onSelect: () => setMoving([r.tc.id]),
    },
    {
      label: 'Delete',
      icon: 'trash' as const,
      danger: true,
      onSelect: () => setConfirmDelete([r.tc.id]),
    },
  ];

  const columns: Column<CaseRow>[] = [
    {
      key: 'id',
      header: 'ID',
      rowHeader: true,
      shrink: true,
      cell: (r) => (
        <button
          type="button"
          className={list.idLink}
          onClick={() => setEditing({ tc: r.tc, tab: 'steps' })}
        >
          {r.tc.id}
        </button>
      ),
    },
    { key: 'title', header: 'Title', cell: (r) => <CaseTitle row={r} /> },
    {
      key: 'status',
      header: 'Automation',
      shrink: true,
      cell: (r) => <StatusBadge status={r.state} />,
    },
    {
      key: 'steps',
      header: 'Steps',
      shrink: true,
      align: 'end',
      cell: (r) => (r.steps ? r.steps : '—'),
    },
    { key: 'params', header: 'Parameters', shrink: true, cell: (r) => <ParamsCell row={r} /> },
    {
      key: 'actions',
      header: <span className="visually-hidden">Actions</span>,
      label: '',
      shrink: true,
      cell: (r) => (
        <span className={list.rowActions}>
          {r.state === 'validated' && selected.size === 0 && (
            <Button size="sm" icon="check" onClick={() => void markReady([r.tc.id])}>
              Mark ready
            </Button>
          )}
          <Menu label={`Actions for ${r.tc.id}`} items={rowMenu(r)} />
        </span>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Test Case Studio"
        description="Create, review and approve the test cases of a project version. Ready cases run from Test Execution."
        actions={
          <Button
            variant="primary"
            icon="plus"
            disabled={!project}
            onClick={() => setCreating(true)}
          >
            Create test cases
          </Button>
        }
      />

      <Panel>
        <div className={styles.controls}>
          <StatusFilter
            label="Filter by automation status"
            active={state}
            onChange={(id) => {
              setState(id as StateFilter);
              reset();
            }}
            chips={[
              { id: 'all', label: 'All', count: count('all') },
              {
                id: 'none',
                label: 'No steps',
                count: count('none'),
                color: 'var(--color-text-muted)',
              },
              {
                id: 'draft',
                label: 'Needs fixing',
                count: count('draft'),
                color: 'var(--color-warning)',
              },
              {
                id: 'validated',
                label: 'To approve',
                count: count('validated'),
                color: 'var(--color-info)',
              },
              {
                id: 'approved',
                label: 'Ready to run',
                count: count('approved'),
                color: 'var(--color-success)',
              },
            ]}
          />
        </div>
      </Panel>

      {(runningConversion || runningAi) && (
        <div className={styles.activity} role="status">
          <span className={styles.pulse} aria-hidden="true" />
          <span>
            {runningConversion &&
              `Turning written steps into runnable steps: ${runningConversion.total - runningConversion.counts.pending} of ${runningConversion.total}.`}{' '}
            {runningAi && `The AI is writing steps: ${runningAi.done} of ${runningAi.total}.`}
          </span>
          {runningConversion && (
            <Button size="sm" variant="ghost" onClick={() => setActivityOpen(true)}>
              Details
            </Button>
          )}
        </div>
      )}

      {lib.error && (
        <Alert tone="danger" title="The test cases could not be loaded">
          {lib.error}
        </Alert>
      )}

      <div>
        <StickyBar>
          {selected.size === 0 ? (
            <div className={styles.toolbar}>
              <SearchBox
                label="Search test cases"
                placeholder="Search by ID, title or module"
                value={q}
                onChange={(v) => {
                  setQ(v);
                  reset();
                }}
              />
              <Select
                aria-label="Test suite"
                value={suiteId}
                onChange={(e) => {
                  setSuiteId(Number(e.target.value));
                  reset();
                }}
              >
                <option value={0}>All suites</option>
                {suites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Button
                icon="sliders"
                aria-expanded={moreFilters}
                aria-controls="studio-more-filters"
                onClick={() => setMoreFilters((m) => !m)}
              >
                Filters{extraFilters > 0 && <Badge tone="primary">{extraFilters}</Badge>}
              </Button>
            </div>
          ) : (
            <div className={styles.bulk} role="region" aria-label="Selected test cases">
              <strong>{selected.size} selected</strong>
              <Button
                size="sm"
                variant="primary"
                icon="check"
                loading={busy === 'ready'}
                onClick={() => void markReady(ids)}
              >
                Mark ready
              </Button>
              <Menu
                label="Write steps"
                triggerLabel="Write steps"
                items={[
                  {
                    label: 'From their written text',
                    icon: 'refresh',
                    onSelect: () => void convert(ids),
                  },
                  { label: 'With AI', icon: 'sparkle', onSelect: () => void writeWithAi(ids) },
                ]}
              />
              <Button
                size="sm"
                icon="sliders"
                loading={busy === 'params'}
                onClick={() => void autoFill(ids)}
              >
                Auto-fill parameters
              </Button>
              <Menu
                label="More actions"
                items={[
                  { label: 'Set version', icon: 'version', onSelect: () => setVersioning(ids) },
                  {
                    label: 'Move to another suite',
                    icon: 'folder',
                    onSelect: () => setMoving(ids),
                  },
                  {
                    label: 'Delete',
                    icon: 'trash',
                    danger: true,
                    onSelect: () => setConfirmDelete(ids),
                  },
                ]}
              />
              <Button size="sm" variant="ghost" icon="close" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          )}
          {moreFilters && selected.size === 0 && (
            <div id="studio-more-filters" className={styles.more}>
              <Select
                aria-label="Priority"
                value={priority}
                onChange={(e) => {
                  setPriority(e.target.value);
                  reset();
                }}
              >
                <option value="">Any priority</option>
                {priorities.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Select>
              <Select
                aria-label="Module"
                value={module}
                onChange={(e) => {
                  setModule(e.target.value);
                  reset();
                }}
              >
                <option value="">Any module</option>
                {modules.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
              <Checkbox
                label="Missing parameters only"
                checked={onlyMissing}
                onChange={(e) => {
                  setOnlyMissing(e.target.checked);
                  reset();
                }}
              />
              {extraFilters > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPriority('');
                    setModule('');
                    setOnlyMissing(false);
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </StickyBar>
        <DataTable
          caption="Test cases"
          columns={columns}
          rows={pageRows}
          rowKey={(r) => r.tc.id}
          selection={{ selected, onChange: setSelected, label: (r) => `Select ${r.tc.id}` }}
          paging={{ page, pageSize: PAGE_SIZE, total: filtered.length, onPage: setPage }}
          empty={
            lib.loading ? (
              <EmptyState icon="refresh" title="Loading test cases…" />
            ) : !project ? (
              <EmptyState
                icon="folder"
                title="Add a project to start"
                action={
                  <a className="button-link" href={href('home')}>
                    Add a project
                  </a>
                }
              >
                Test cases belong to a project and a version.
              </EmptyState>
            ) : scoped.length === 0 ? (
              <EmptyState
                icon="cases"
                title="No test cases here yet"
                action={
                  <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                    Create test cases
                  </Button>
                }
              >
                Import a workbook, generate with AI, write one by hand or bring them from Azure
                DevOps.
              </EmptyState>
            ) : (
              <EmptyState icon="search" title="No test case matches these filters" />
            )
          }
        />
      </div>

      {creating && project && (
        <CreateCasesDialog
          project={project}
          versions={lib.versions}
          suites={lib.suites}
          initialVersionId={versionId}
          ai={ai.data}
          onClose={() => setCreating(false)}
          onExcel={(d) => {
            setCreating(false);
            setImportTarget(d);
          }}
          onManual={(d) => {
            setCreating(false);
            setManual(d);
          }}
          onAiSaved={() => {
            lib.reload();
            aiJobs.reload();
          }}
        />
      )}
      {importTarget && (
        <ImportDialog
          existing={lib.rows.length}
          target={importTarget}
          onClose={() => setImportTarget(undefined)}
          onImported={(_job, n) => {
            setImportTarget(undefined);
            lib.reload();
            conversions.reload();
            toast.show(
              `Imported ${plural(n, 'test case')}. Turning their written steps into runnable steps…`,
              {
                tone: 'info',
              },
            );
          }}
        />
      )}
      {manual && project && (
        <NewCaseDialog
          projects={[project]}
          suites={suites}
          initialSuiteId={manual.testSuiteId ?? suites.find((s) => s.isActive)?.id}
          projectVersionId={manual.projectVersionId}
          onClose={() => setManual(undefined)}
          onCreated={(tc) => {
            setManual(undefined);
            lib.reload();
            setEditing({ tc, tab: 'steps' });
          }}
        />
      )}
      {editing && (
        <CaseEditorDialog
          testCase={editing.tc}
          initialTab={editing.tab}
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
      {moving && (
        <MoveCasesDialog
          ids={moving}
          projects={lib.projects}
          suites={lib.suites}
          onClose={() => setMoving(undefined)}
          onMoved={(moved, suiteName) => {
            setMoving(undefined);
            setSelected(new Set());
            lib.reload();
            toast.show(`Moved ${plural(moved, 'test case')} to ${suiteName}.`);
          }}
        />
      )}
      {versioning && (
        <AssignVersionDialog
          ids={versioning}
          projectId={projectId || undefined}
          versions={lib.versions}
          onClose={() => setVersioning(undefined)}
          onAssigned={(n, name) => {
            setVersioning(undefined);
            setSelected(new Set());
            lib.reload();
            toast.show(
              name
                ? `${plural(n, 'test case')} set to version ${name}.`
                : `Cleared the version of ${plural(n, 'test case')}.`,
            );
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${plural(confirmDelete.length, 'test case')}?`}
          confirmLabel="Delete"
          danger
          busy={busy === 'delete'}
          {...(confirmDelete.length > 5 && { typeToConfirm: String(confirmDelete.length) })}
          onConfirm={() => void remove(confirmDelete)}
          onCancel={() => setConfirmDelete(undefined)}
        >
          The test case{confirmDelete.length === 1 ? '' : 's'} and{' '}
          {confirmDelete.length === 1 ? 'its' : 'their'} steps are removed. Past run results stay in
          Run History.
        </ConfirmDialog>
      )}
      {activityOpen && (
        <Dialog
          title="Turning written steps into runnable steps"
          size="lg"
          onClose={() => setActivityOpen(false)}
        >
          <div className={list.jobs}>
            {(conversions.data ?? []).slice(0, 3).map((j) => (
              <ConversionCard
                key={j.id}
                job={j}
                onChanged={() => {
                  conversions.reload();
                  lib.reload();
                }}
                onOpenCase={(id) => {
                  const tc = lib.rows.find((r) => r.tc.id === id)?.tc;
                  if (tc) {
                    setActivityOpen(false);
                    setEditing({ tc, tab: 'steps' });
                  }
                }}
              />
            ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}
