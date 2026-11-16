/**
 * CaseEditorDialog: everything about one test case in one popup, without ever showing JSON.
 *
 * Layout: a header (ID, title, status, where it is filed), a **readiness** strip saying what still stands between the
 * case and a run (steps valid, parameters set, approved) — each item opens the tab that fixes it — then the tabs, and a
 * footer whose note says the one next thing to do. Wide screens show readiness and the case's facts in a side rail;
 * phones show the popup as a full-screen sheet with readiness as a row of chips above the tabs.
 *
 * - Steps: the visual step editor. Valid steps run from the next run on; steps with problems are kept as a draft and the
 *   last valid version keeps running. If someone else saved in the meantime the save is refused, so no change is lost.
 * - Details: the case as written (steps, expected result, source workbook).
 * - Parameters: the values the steps read as {{data.name}}, per case or common to the project.
 * - Runs: this case's latest results. History: earlier versions, with Restore.
 */
import { href, navigate } from '../../../shared/hooks/useRoute.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  Icon,
  IconButton,
  Spinner,
  StatusBadge,
  Tabs,
  tabPanelProps,
  useToast,
} from '../../../design-system/index.js';
import { useCatalog } from '../../../shared/api/catalog.js';
import { ApiError, errorMessage } from '../../../shared/api/http.js';
import { useDebounced } from '../../../shared/hooks/useAsync.js';
import { formatDate } from '../../../shared/lib/format.js';
import { ParametersPanel } from './ParametersPanel.js';
import { StartRunDialog } from '../../runs/components/StartRunDialog.js';
import { fetchRuns, type RunView } from '../../runs/api.js';
import {
  approveDraft,
  dataNamesIn,
  fetchParameters,
  checkSteps,
  fetchHistory,
  fetchScenario,
  restoreVersion,
  saveSteps,
  type ParameterItem,
  type ScenarioDetail,
  type ScenarioRecord,
  type Step,
  type StepCheck,
  type TestCase,
} from '../api.js';
import { StepEditor } from './StepEditor.js';
import { StepGuide } from './StepGuide.js';
import styles from './CaseEditor.module.css';

type TabId = 'steps' | 'details' | 'data' | 'runs' | 'history';

/** Whether this case's parameters could be read: the worker may be older than the web app. */
type ParamState = 'loading' | 'ok' | 'unavailable';

/** One line of the readiness check: what it is, how it stands, and the tab that fixes it. */
interface Readiness {
  id: string;
  label: string;
  text: string;
  state: 'ok' | 'warn' | 'todo';
  tab: TabId;
}

/** Props of `CaseEditorDialog`. */
export interface CaseEditorDialogProps {
  testCase: TestCase;
  /** The tab to open on, such as "history" from a list's History action. */
  initialTab?: 'steps' | 'details' | 'data' | 'runs' | 'history';
  onClose: () => void;
  /** Called after anything was saved, so the list refreshes. */
  onChanged: () => void;
}

/** The version a person should edit: a waiting draft (to fix or approve it) or else the approved one. */
const editable = (d: ScenarioDetail | undefined) => d?.draft ?? d?.approved;
const latestVersion = (d: ScenarioDetail | undefined) =>
  Math.max(d?.draft?.version ?? 0, d?.approved?.version ?? 0);

/** The popup for one case: steps, details, parameters, runs and history. */
export function CaseEditorDialog({
  testCase,
  onClose,
  onChanged,
  initialTab,
}: CaseEditorDialogProps) {
  const tc = testCase;
  const toast = useToast();
  // The steps this case's project may use (standard ones, and the ones the project defined) and its pages.
  const catalog = useCatalog(tc.projectId ?? 0);
  const [tab, setTab] = useState<TabId>(initialTab ?? 'steps');
  const [detail, setDetail] = useState<ScenarioDetail>();
  const [loadError, setLoadError] = useState('');
  const [steps, setSteps] = useState<Step[]>([]);
  const [baseline, setBaseline] = useState('[]');
  const [checks, setChecks] = useState<StepCheck[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState(false);
  // Opens full screen, so every step, label and box shows in full; the header button gives the smaller popup back.
  const [expanded, setExpanded] = useState(true);
  const [running, setRunning] = useState(false);
  /** Saved parameter values of this case, so the footer and tab can say what is missing. */
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [paramState, setParamState] = useState<ParamState>('loading');

  const load = async () => {
    try {
      const d = await fetchScenario(tc.id);
      const s = editable(d)?.scenario.steps ?? [];
      setDetail(d);
      setSteps(s);
      setBaseline(JSON.stringify(s));
      setConflict(false);
      setLoadError('');
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  };
  useEffect(() => {
    void load();
    fetchParameters(tc.id).then(
      (r) => {
        setParamValues(effectiveValues(r.items));
        setParamState('ok');
      },
      () => setParamState('unavailable'),
    );
    // Load once per opened case.
  }, [tc.id]);

  const dirty = JSON.stringify(steps) !== baseline;

  // Check the steps on the server while they are edited (debounced), so problems show on the step.
  const debounced = useDebounced(steps, 400);
  const checkSeq = useRef(0);
  useEffect(() => {
    if (debounced.length === 0) {
      setChecks([]);
      return;
    }
    const mine = ++checkSeq.current;
    checkSteps(debounced).then(
      (c) => mine === checkSeq.current && setChecks(c),
      () => undefined,
    );
  }, [debounced]);

  const problems = checks.reduce((n, c) => n + c.issues.length, 0);
  const usedNames = useMemo(() => dataNamesIn(steps), [steps]);
  // Only known once the parameters loaded; an unreachable parameter service is reported apart, not as "missing".
  const missing = paramState === 'ok' ? usedNames.filter((n) => !paramValues[n]) : [];

  const save = async (close: boolean) => {
    setSaving(true);
    setSaveError('');
    try {
      const r = await saveSteps(tc.id, { steps, expectedVersion: latestVersion(detail) });
      setBaseline(JSON.stringify(steps));
      onChanged();
      toast.show(
        r.status === 'approved'
          ? `Saved ${tc.id} as version ${r.version}. It runs from now on.`
          : `Saved ${tc.id} as a draft: ${r.issues.length} problem${r.issues.length === 1 ? '' : 's'} to fix.`,
        { tone: r.status === 'approved' ? 'success' : 'info' },
      );
      if (close) onClose();
      else await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      setSaveError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const approve = async () => {
    setSaving(true);
    try {
      await approveDraft(tc.id);
      toast.show(`${tc.id} approved. It runs from now on.`);
      onChanged();
      await load();
    } catch (e) {
      setSaveError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const current = editable(detail);
  const pendingDraft = detail?.draft && !dirty ? detail.draft : undefined;

  const readiness: Readiness[] = [
    {
      id: 'steps',
      label: 'Steps',
      tab: 'steps',
      ...(steps.length === 0
        ? { state: 'todo' as const, text: 'No steps yet' }
        : problems > 0
          ? {
              state: 'warn' as const,
              text: `${problems} problem${problems === 1 ? '' : 's'} to fix`,
            }
          : {
              state: 'ok' as const,
              text: `${steps.length} step${steps.length === 1 ? '' : 's'}, all valid`,
            }),
    },
    {
      id: 'params',
      label: 'Parameters',
      tab: 'data',
      ...(paramState === 'loading'
        ? { state: 'todo' as const, text: 'Checking…' }
        : paramState === 'unavailable'
          ? { state: 'warn' as const, text: 'Cannot be checked' }
          : missing.length > 0
            ? { state: 'warn' as const, text: `Missing: ${missing.join(', ')}` }
            : {
                state: 'ok' as const,
                text: usedNames.length > 0 ? 'Every value is set' : 'None needed',
              }),
    },
    {
      id: 'approval',
      label: 'Approval',
      tab: 'steps',
      ...(!detail
        ? { state: 'todo' as const, text: 'Checking…' }
        : detail.approved && !detail.draft
          ? { state: 'ok' as const, text: `Ready to run · v${detail.approved.version}` }
          : detail.draft
            ? {
                state: 'warn' as const,
                text: detail.approved
                  ? `v${detail.approved.version} runs; draft v${detail.draft.version} waiting`
                  : `Draft v${detail.draft.version} to approve`,
              }
            : { state: 'todo' as const, text: 'Not approved yet' }),
    },
  ];
  const facts: [string, string | undefined][] = [
    ['Project', tc.projectName],
    ['Suite', tc.testSuiteName],
    ['Version', tc.projectVersionName],
    ['Module', tc.module],
    ['Priority', tc.priority],
  ];

  const note: { tone: 'ok' | 'warn' | 'todo'; text: string } =
    steps.length === 0
      ? { tone: 'todo', text: 'Add steps to automate this case.' }
      : problems > 0
        ? { tone: 'warn', text: `${problems} problem${problems === 1 ? '' : 's'} to fix` }
        : paramState === 'unavailable'
          ? { tone: 'warn', text: 'Parameters cannot be checked: restart the worker' }
          : missing.length > 0
            ? { tone: 'warn', text: `Parameter missing: ${missing.join(', ')}` }
            : { tone: 'ok', text: dirty ? 'All steps are valid · unsaved' : 'All steps are valid' };

  const status = current ? (
    <StatusBadge
      status={current.status}
      label={`${current.status === 'approved' ? 'Ready to run' : current.status === 'validated' ? 'To approve' : 'Needs fixing'} · v${current.version}`}
    />
  ) : (
    <StatusBadge status="none" />
  );

  return (
    <>
      <Dialog
        title={
          <span className={styles.title}>
            <span className={styles.caseId}>{tc.id}</span>
            <span className={styles.titleText}>{tc.title}</span>
          </span>
        }
        subtitle={
          <>
            {status}
            {tc.projectName && (
              <span className={styles.where}>
                <Icon name="folder" size={14} />
                {tc.projectName}
                {tc.testSuiteName && ` › ${tc.testSuiteName}`}
                {tc.projectVersionName && ` · v${tc.projectVersionName}`}
              </span>
            )}
            {current && <span className={styles.saved}>Saved {formatDate(current.updatedAt)}</span>}
          </>
        }
        size="lg"
        expanded={expanded}
        dirty={dirty}
        onClose={onClose}
        onSave={() => dirty && !saving && void save(false)}
        headerActions={
          <>
            <Button
              size="sm"
              icon="play"
              onClick={() => setRunning(true)}
              disabled={dirty || !detail?.approved}
            >
              Run
            </Button>
            <IconButton
              icon="expand"
              label={expanded ? 'Exit full screen' : 'Full screen'}
              onClick={() => setExpanded((x) => !x)}
            />
          </>
        }
        footer={
          <>
            <span className={styles.footerNote} data-tone={note.tone} aria-live="polite">
              <Icon
                name={note.tone === 'ok' ? 'check' : note.tone === 'warn' ? 'alert' : 'info'}
                size={16}
              />
              <span>{note.text}</span>
            </span>
            <div className={styles.footerActions}>
              {pendingDraft?.status === 'validated' && (
                <Button onClick={() => void approve()} disabled={saving}>
                  Approve draft
                </Button>
              )}
              <Button className={styles.closeButton} data-dialog-close>
                Close
              </Button>
              <Button
                onClick={() => void save(false)}
                disabled={!dirty || steps.length === 0}
                loading={saving}
              >
                Save
              </Button>
              <Button
                variant="primary"
                onClick={() => void save(true)}
                disabled={!dirty || steps.length === 0 || saving}
              >
                Save &amp; close
              </Button>
            </div>
          </>
        }
      >
        <div className={styles.frame}>
          <div className={styles.layout}>
            <aside className={styles.rail} aria-label="Readiness">
              <h3 className={styles.railHead}>Ready to run?</h3>
              <ul className={styles.checks}>
                {readiness.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={styles.check}
                      data-state={r.state}
                      onClick={() => setTab(r.tab)}
                    >
                      <span className={styles.checkIcon} aria-hidden="true">
                        <Icon
                          name={r.state === 'ok' ? 'check' : r.state === 'warn' ? 'alert' : 'clock'}
                          size={14}
                        />
                      </span>
                      <span className={styles.checkText}>
                        <strong>{r.label}</strong>
                        <span>{r.text}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {facts.some(([, v]) => v) && (
                <dl className={styles.facts}>
                  {facts
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                </dl>
              )}
            </aside>
            <div className={styles.main}>
              <Tabs
                label="Test case"
                idPrefix="case"
                active={tab}
                onChange={(t) => setTab(t as TabId)}
                tabs={[
                  { id: 'steps', label: 'Steps', badge: steps.length },
                  { id: 'details', label: 'Details' },
                  {
                    id: 'data',
                    label: 'Parameters',
                    ...(missing.length > 0 && { badge: `${missing.length} missing` }),
                    ...(paramState === 'unavailable' && { badge: '!' }),
                  },
                  { id: 'runs', label: 'Runs' },
                  { id: 'history', label: 'History' },
                ]}
              />
              <div className={styles.panel} {...tabPanelProps(tab, 'case')}>
                {tab === 'steps' &&
                  (loadError ? (
                    <Alert tone="danger" title="The steps could not be loaded">
                      {loadError}
                    </Alert>
                  ) : !detail || !catalog ? (
                    <p className={styles.loading}>
                      <Spinner /> Loading steps…
                    </p>
                  ) : (
                    <div className={styles.stack}>
                      {conflict && (
                        <Alert
                          tone="warning"
                          title="Someone else saved this case"
                          actions={
                            <Button size="sm" onClick={() => void load()}>
                              Reload their version
                            </Button>
                          }
                        >
                          Your changes were not saved, so nothing was overwritten. Reload to see the
                          newer version.
                        </Alert>
                      )}
                      {saveError && !conflict && <Alert tone="danger">{saveError}</Alert>}
                      {pendingDraft && (
                        <Alert
                          tone={pendingDraft.status === 'validated' ? 'info' : 'warning'}
                          title={draftTitle(pendingDraft)}
                        >
                          {pendingDraft.note ?? 'Check the steps below.'}
                          {detail.approved &&
                            ` Version ${detail.approved.version} keeps running until this is approved.`}
                        </Alert>
                      )}
                      <StepGuide defaultOpen={steps.length === 0} />
                      <StepEditor
                        steps={steps}
                        onChange={setSteps}
                        actions={catalog.actions}
                        pages={catalog.pages}
                        dataNames={[...new Set([...Object.keys(paramValues), ...usedNames])]}
                        values={paramState === 'ok' ? paramValues : undefined}
                        checks={checks}
                      />
                    </div>
                  ))}
                {tab === 'details' && <CaseDetails tc={tc} />}
                {tab === 'data' && (
                  <ParametersPanel
                    caseId={tc.id}
                    stepNames={usedNames}
                    onLoaded={(v) => {
                      setParamValues(effectiveValues(v.items));
                      setParamState('ok');
                    }}
                    onSaved={(v) => setParamValues(effectiveValues(v.items))}
                  />
                )}
                {tab === 'runs' && <CaseRuns caseId={tc.id} />}
                {tab === 'history' && (
                  <CaseHistory
                    caseId={tc.id}
                    current={detail?.approved}
                    onRestored={() => {
                      onChanged();
                      void load();
                      setTab('steps');
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </Dialog>
      {running && (
        <StartRunDialog
          caseIds={[tc.id]}
          onClose={() => setRunning(false)}
          onStarted={(run) => {
            setRunning(false);
            toast.show(`Run started for ${tc.id}.`, {
              tone: 'info',
              action: {
                label: 'View run',
                onClick: () => navigate(href('runs', run.id)),
              },
            });
          }}
        />
      )}
    </>
  );
}

/** The value each name runs with: the case's own, else the project's common value. */
function effectiveValues(items: ParameterItem[]): Record<string, string> {
  return Object.fromEntries(items.map((i) => [i.name, i.value || i.common || '']));
}

function draftTitle(d: ScenarioRecord): string {
  const who = d.origin === 'ai' ? 'AI' : d.origin === 'rules' ? 'the Excel import' : 'hand';
  return d.status === 'validated'
    ? `Draft v${d.version} written by ${who}: ready to approve`
    : `Draft v${d.version} written by ${who}: needs fixing`;
}

/** The case as written in the workbook. */
function CaseDetails({ tc }: { tc: TestCase }) {
  const rows: [string, string | undefined][] = [
    ['Module', tc.module],
    ['Priority', tc.priority],
    ['Preconditions', tc.preconditions],
    ['Expected result', tc.expectedResult],
    ['Source', `${tc.source.workbook} › ${tc.source.worksheet}, row ${tc.source.rowNumber}`],
  ];
  return (
    <div className={styles.stack}>
      <dl className={styles.details}>
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      <div>
        <h3 className={styles.subhead}>Written steps</h3>
        {tc.steps.length === 0 ? (
          <p className={styles.muted}>The workbook gave no steps.</p>
        ) : (
          <ol className={styles.written}>
            {tc.steps.map((s) => (
              <li key={s.order}>
                {s.action}
                {s.expected && <span className={styles.muted}> → {s.expected}</span>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/** This case's results in the latest runs. */
function CaseRuns({ caseId }: { caseId: string }) {
  const [runs, setRuns] = useState<RunView[]>();
  useEffect(() => {
    fetchRuns().then(setRuns, () => setRuns([]));
  }, []);
  if (!runs)
    return (
      <p className={styles.loading}>
        <Spinner /> Loading runs…
      </p>
    );
  const results = runs.flatMap((r) =>
    r.cases.filter((c) => c.caseId === caseId).map((c) => ({ run: r, result: c })),
  );
  if (results.length === 0) {
    return (
      <EmptyState icon="runs" title="Not run yet">
        Use Run at the top to run this case.
      </EmptyState>
    );
  }
  return (
    <ul className={styles.timeline}>
      {results.slice(0, 20).map(({ run, result }, i) => (
        <li key={`${run.id}-${i}`}>
          <StatusBadge status={result.status} />
          <span>{formatDate(result.startedAt ?? run.createdAt)}</span>
          {result.account && <span className={styles.muted}>as {result.account}</span>}
          {result.failure && <span className={styles.failure}>{result.failure.message}</span>}
          <a href={href('runs', run.id)}>Open run</a>
        </li>
      ))}
    </ul>
  );
}

/** Earlier versions of the steps, newest first, each restorable as a new version. */
function CaseHistory({
  caseId,
  current,
  onRestored,
}: {
  caseId: string;
  current: ScenarioRecord | undefined;
  onRestored: () => void;
}) {
  const toast = useToast();
  const [items, setItems] = useState<ScenarioRecord[]>();
  useEffect(() => {
    fetchHistory(caseId).then(setItems, () => setItems([]));
  }, [caseId]);
  if (!items)
    return (
      <p className={styles.loading}>
        <Spinner /> Loading history…
      </p>
    );
  if (!current && items.length === 0) {
    return (
      <EmptyState icon="history" title="No versions yet">
        Each save is kept here, so it can be undone.
      </EmptyState>
    );
  }
  const origin = (r: ScenarioRecord) =>
    ({ manual: 'by hand', ai: 'by AI', file: 'from a file', rules: 'from the Excel import' })[
      r.origin
    ];
  return (
    <ul className={styles.timeline}>
      {current && (
        <li>
          <StatusBadge status="approved" label={`v${current.version} · current`} />
          <span>{formatDate(current.approvedAt ?? current.updatedAt)}</span>
          <span className={styles.muted}>
            {origin(current)} · {current.scenario.steps.length} steps
          </span>
        </li>
      )}
      {items.map((r) => (
        <li key={r.version}>
          <StatusBadge status="skipped" label={`v${r.version}`} />
          <span>{formatDate(r.approvedAt ?? r.updatedAt)}</span>
          <span className={styles.muted}>
            {origin(r)} · {r.scenario.steps.length} steps
          </span>
          <Button
            size="sm"
            icon="history"
            onClick={() =>
              void restoreVersion(caseId, r.version).then(
                (n) => {
                  toast.show(`Version ${r.version} restored as version ${n.version}.`);
                  onRestored();
                },
                (e: unknown) => toast.show(errorMessage(e), { tone: 'danger' }),
              )
            }
          >
            Restore
          </Button>
        </li>
      ))}
    </ul>
  );
}
