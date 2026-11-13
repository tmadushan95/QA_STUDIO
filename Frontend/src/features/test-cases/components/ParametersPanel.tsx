/**
 * ParametersPanel: the values one test case's steps read as `{{data.name}}`. Used in the case editor, on Test Case Studio
 * (before a case is marked ready) and on Test Execution (just before a run).
 *
 * Each value comes from one of two places, chosen per row:
 * - **This case** — a value only this case uses (typed here).
 * - **Project common** — the value set once for the whole project (Project settings › Parameters). Changing it there
 *   changes it for every case that uses it.
 * A row with neither is missing, and the case is blocked when it runs.
 *
 * "Auto-fill" puts suggested values (old test data, the AI, or a guess from the name) into the empty case values for
 * the person to check. Nothing is saved until "Save parameters".
 *
 * When the parameter service cannot be reached (typically a worker started before an update), the panel still lists the
 * names the steps read, says exactly how to fix it, and offers "Try again" — instead of a bare error.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Icon,
  Spinner,
  TextInput,
  useToast,
} from '../../../design-system/index.js';
import { ApiError, errorMessage } from '../../../shared/api/http.js';
import { href } from '../../../shared/hooks/useRoute.js';
import {
  fetchParameters,
  saveParameters,
  suggestParameters,
  type CaseParameters,
  type ParameterItem,
  type ParameterSuggestion,
} from '../api.js';
import styles from './Parameters.module.css';

/** Props of `ParametersPanel`. */
export interface ParametersPanelProps {
  caseId: string;
  /** The names the case's steps read, shown even when the values cannot be loaded. */
  stepNames?: string[];
  /** Called once the values loaded, so a surrounding dialog can update what it says is missing. */
  onLoaded?: (view: CaseParameters) => void;
  /** Called after a save, with the missing names that remain (empty when the case can run). */
  onSaved?: (view: CaseParameters) => void;
  /** Called whenever the form's unsaved state changes, so a surrounding dialog can ask before closing. */
  onDirtyChange?: (dirty: boolean) => void;
}

type Mode = 'case' | 'common';

const SUGGESTED: Record<ParameterSuggestion['source'], string> = {
  legacy: 'From old test data',
  ai: 'Suggested by AI',
  guess: 'Suggested',
};

/** The starting choice of a row: its own value if it has one, else the common value when there is one. */
const initialMode = (i: ParameterItem): Mode => (i.value || !i.common ? 'case' : 'common');

/** Why the values could not be loaded: an outdated worker (it has no such route) or another error. */
interface LoadProblem {
  outdated: boolean;
  message: string;
}

function loadProblem(e: unknown): LoadProblem {
  const outdated =
    e instanceof ApiError && (e.code === 'route-not-found' || e.code === 'not-found');
  return { outdated, message: errorMessage(e) };
}

/** The parameter form of one test case. */
export function ParametersPanel({
  caseId,
  stepNames = [],
  onLoaded,
  onSaved,
  onDirtyChange,
}: ParametersPanelProps) {
  const toast = useToast();
  const [view, setView] = useState<CaseParameters>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [suggested, setSuggested] = useState<Record<string, ParameterSuggestion['source']>>({});
  const [error, setError] = useState<LoadProblem>();
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<'' | 'save' | 'fill'>('');

  const reset = (v: CaseParameters) => {
    setView(v);
    setValues(Object.fromEntries(v.items.map((i) => [i.name, i.value])));
    setModes(Object.fromEntries(v.items.map((i) => [i.name, initialMode(i)])));
    setSuggested({});
  };

  useEffect(() => {
    let live = true;
    setError(undefined);
    fetchParameters(caseId).then(
      (v) => {
        if (!live) return;
        reset(v);
        onLoaded?.(v);
      },
      (e: unknown) => live && setError(loadProblem(e)),
    );
    return () => {
      live = false;
    };
  }, [caseId, attempt]);

  // What would be saved: a case value only for rows on "This case"; rows on "Project common" send nothing.
  const outgoing = (): Record<string, string> =>
    Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, modes[k] === 'common' ? '' : v.trim()]),
    );
  const dirty =
    view !== undefined && view.items.some((i) => (outgoing()[i.name] ?? '') !== i.value);
  useEffect(() => onDirtyChange?.(dirty), [dirty]);

  if (error)
    return (
      <Unavailable problem={error} names={stepNames} onRetry={() => setAttempt((n) => n + 1)} />
    );
  if (!view)
    return (
      <p className={styles.loading}>
        <Spinner /> Loading parameters…
      </p>
    );
  if (view.items.length === 0) {
    return (
      <EmptyState icon="sliders" title="This test case needs no parameters">
        Steps can read a value as <code>{'{{data.name}}'}</code>, for example a project code. Insert
        one from a step’s text field and it shows here.
      </EmptyState>
    );
  }

  const missingOf = (i: ParameterItem) =>
    i.used && (modes[i.name] === 'common' ? !i.common : !values[i.name]?.trim());
  const missing = view.items.filter(missingOf).map((i) => i.name);
  const commonLink = href('project-settings', 'parameters');

  const fill = async () => {
    setBusy('fill');
    try {
      const s = await suggestParameters(caseId);
      // Only rows that still need a case value take a suggestion; a row on its common value is left alone.
      const usable = s.filter((x) => modes[x.name] !== 'common');
      if (usable.length === 0) {
        toast.show('Nothing to fill: every value is set, or the names look like secrets.', {
          tone: 'info',
        });
        return;
      }
      setValues((v) => ({ ...v, ...Object.fromEntries(usable.map((x) => [x.name, x.value])) }));
      setSuggested((src) => ({
        ...src,
        ...Object.fromEntries(usable.map((x) => [x.name, x.source])),
      }));
      toast.show(
        `Filled ${usable.length} value${usable.length === 1 ? '' : 's'}. Check them, then save.`,
        { tone: 'info' },
      );
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      const v = await saveParameters(caseId, outgoing());
      reset(v);
      onSaved?.(v);
      toast.show(
        v.missing.length === 0
          ? 'Parameters saved. The case has every value it needs.'
          : 'Parameters saved.',
      );
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <p className={styles.muted}>
          Choose per value: <strong>This case</strong> (only this test case) or{' '}
          <strong>Project common</strong> (shared by the project’s cases,{' '}
          <a href={commonLink}>edited here</a>). A missing value blocks the case when it runs.
        </p>
        <Button
          size="sm"
          icon="sparkle"
          onClick={() => void fill()}
          loading={busy === 'fill'}
          disabled={missing.length === 0}
        >
          Auto-fill {missing.length > 0 ? `(${missing.length})` : ''}
        </Button>
      </div>
      <div className={styles.grid}>
        {view.items.map((item) => {
          const mode = modes[item.name] ?? 'case';
          const value = values[item.name] ?? '';
          const id = `param-${caseId}-${item.name}`;
          const isMissing = missingOf(item);
          return (
            <div
              key={item.name}
              className={isMissing ? `${styles.row} ${styles.rowMissing}` : styles.row}
            >
              <div className={styles.name}>
                <label htmlFor={id}>
                  <code>{item.name}</code>
                </label>
                {!item.used && <Badge tone="neutral">Not used by the steps</Badge>}
                {suggested[item.name] && mode === 'case' && (
                  <Badge tone="info">{SUGGESTED[suggested[item.name]!]}</Badge>
                )}
                {isMissing && (
                  <Badge tone="warning" glyph="!">
                    Missing
                  </Badge>
                )}
              </div>
              <div className={styles.control}>
                <div
                  className={styles.segment}
                  role="radiogroup"
                  aria-label={`Source of ${item.name}`}
                >
                  {(['case', 'common'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={mode === m}
                      className={mode === m ? styles.segOn : styles.seg}
                      onClick={() => setModes({ ...modes, [item.name]: m })}
                    >
                      {m === 'case' ? 'This case' : 'Project common'}
                    </button>
                  ))}
                </div>
                {mode === 'case' ? (
                  <TextInput
                    id={id}
                    value={value}
                    invalid={isMissing}
                    placeholder={
                      item.common
                        ? `Common value: ${item.common}`
                        : item.used
                          ? 'Missing'
                          : 'Leave empty to remove'
                    }
                    maxLength={500}
                    onChange={(e) => setValues({ ...values, [item.name]: e.target.value })}
                  />
                ) : (
                  <p id={id} className={styles.inherited} aria-live="polite">
                    {item.common ? (
                      <>
                        Uses <strong>{item.common}</strong>
                      </>
                    ) : (
                      <>
                        No common value yet. <a href={commonLink}>Set it for the project</a>
                      </>
                    )}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className={styles.foot}>
        <span className={styles.muted} aria-live="polite">
          {missing.length > 0
            ? `${missing.length} missing: ${missing.join(', ')}`
            : '✓ Every value is set'}
        </span>
        <Button
          variant="primary"
          onClick={() => void save()}
          loading={busy === 'save'}
          disabled={!dirty}
        >
          Save parameters
        </Button>
      </div>
    </div>
  );
}

/**
 * Shown when the values cannot be loaded. An outdated worker is the usual cause: the web app and API were updated and
 * restarted, but the Node worker still runs the build it started with. The names the steps read are still listed, so
 * the person sees what the case needs.
 */
function Unavailable({
  problem,
  names,
  onRetry,
}: {
  problem: LoadProblem;
  names: string[];
  onRetry: () => void;
}) {
  return (
    <div className={styles.unavailable}>
      <Alert
        tone="warning"
        title={
          problem.outdated
            ? 'The test runner needs a restart to show parameters'
            : 'The parameters could not be loaded'
        }
        actions={
          <Button size="sm" icon="refresh" onClick={onRetry}>
            Try again
          </Button>
        }
      >
        {problem.outdated ? (
          <>
            The web app was updated, but the worker that runs tests still runs the version it
            started with. Stop it and start it again, then press <strong>Try again</strong>:
            <code className={styles.command}>cd Backend/Worker &amp;&amp; npm run worker</code>
            (or <code>npm start</code>, which starts the API and the worker together).
          </>
        ) : (
          problem.message
        )}
      </Alert>
      {names.length > 0 && (
        <div>
          <h3 className={styles.namesHead}>The steps read these values</h3>
          <ul className={styles.names}>
            {names.map((n) => (
              <li key={n}>
                <Icon name="sliders" size={14} />
                <code>{n}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
