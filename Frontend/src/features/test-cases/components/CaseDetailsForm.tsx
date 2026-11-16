/**
 * CaseDetailsForm: edits a test case as written (title, module, priority, preconditions, written steps with their
 * expected results, and the overall expected result). The runnable steps are edited on the Steps tab; this is the
 * text a tester reads.
 *
 * Saving sends the version the form opened, so a newer save by someone else is refused instead of overwritten.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Field,
  IconButton,
  Select,
  TextArea,
  TextInput,
} from '../../../design-system/index.js';
import { ApiError, errorMessage } from '../../../shared/api/http.js';
import { updateCase, type TestCase } from '../api.js';
import styles from './CaseEditor.module.css';

/** Props of `CaseDetailsForm`. */
export interface CaseDetailsFormProps {
  tc: TestCase;
  /** Called with the saved case. */
  onSaved: (tc: TestCase) => void;
  onCancel: () => void;
  /** Tells the dialog whether there are unsaved changes, so closing it asks first. */
  onDirtyChange: (dirty: boolean) => void;
}

interface WrittenStep {
  action: string;
  expected: string;
}

const PRIORITIES = ['High', 'Medium', 'Low'];

const formOf = (tc: TestCase) => ({
  title: tc.title,
  module: tc.module ?? '',
  priority: tc.priority ?? '',
  preconditions: tc.preconditions ?? '',
  expectedResult: tc.expectedResult ?? '',
  steps: tc.steps.map((s): WrittenStep => ({ action: s.action, expected: s.expected ?? '' })),
});

/** An optional text: trimmed, and left out when empty. */
const opt = (s: string) => s.trim() || undefined;

/** The edit form for a written test case. */
export function CaseDetailsForm({ tc, onSaved, onCancel, onDirtyChange }: CaseDetailsFormProps) {
  const [initial] = useState(() => JSON.stringify(formOf(tc)));
  const [v, setV] = useState(() => formOf(tc));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);

  const update = (next: typeof v) => {
    setV(next);
    onDirtyChange(JSON.stringify(next) !== initial);
  };
  const set =
    (k: 'title' | 'module' | 'priority' | 'preconditions' | 'expectedResult') =>
    (e: { target: { value: string } }) =>
      update({ ...v, [k]: e.target.value });
  const setStep = (i: number, k: keyof WrittenStep, value: string) =>
    update({ ...v, steps: v.steps.map((s, j) => (j === i ? { ...s, [k]: value } : s)) });
  const moveStep = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= v.steps.length) return;
    const steps = [...v.steps];
    [steps[i], steps[j]] = [steps[j]!, steps[i]!];
    update({ ...v, steps });
  };

  const save = async () => {
    setBusy(true);
    setError('');
    setErrors({});
    try {
      const saved = await updateCase(tc, {
        testSuiteId: tc.testSuiteId ?? 0,
        title: v.title.trim(),
        module: opt(v.module),
        priority: opt(v.priority),
        preconditions: opt(v.preconditions),
        expectedResult: opt(v.expectedResult),
        // Empty rows are dropped, so an added-but-unused row never becomes a blank step.
        writtenSteps: v.steps
          .filter((s) => s.action.trim())
          .map((s) => ({ action: s.action.trim(), expected: opt(s.expected) })),
        rowVersion: tc.rowVersion,
      });
      onDirtyChange(false);
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError) {
        setConflict(e.status === 409);
        setErrors(e.fields);
      }
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <form
      className={styles.stack}
      aria-label="Edit test case"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {conflict ? (
        <Alert tone="warning" title="Someone else saved this case">
          Your changes were not saved, so nothing was overwritten. Cancel and open the case again to
          see the newer version.
        </Alert>
      ) : (
        error && Object.keys(errors).length === 0 && <Alert tone="danger">{error}</Alert>
      )}
      <Field label="Title" required error={errors['title']}>
        {(p) => <TextInput {...p} data-autofocus value={v.title} onChange={set('title')} />}
      </Field>
      <div className={styles.formRow}>
        <Field label="Module" error={errors['module']}>
          {(p) => <TextInput {...p} value={v.module} onChange={set('module')} />}
        </Field>
        <Field label="Priority">
          {(p) => (
            <Select {...p} value={v.priority} onChange={set('priority')}>
              <option value="">Not set</option>
              {/* Keep a priority the list does not know, such as one imported from Excel. */}
              {[...new Set([...PRIORITIES, ...(v.priority ? [v.priority] : [])])].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Preconditions" error={errors['preconditions']}>
        {(p) => (
          <TextArea {...p} rows={2} value={v.preconditions} onChange={set('preconditions')} />
        )}
      </Field>
      <fieldset className={styles.writtenEdit}>
        <legend className={styles.subhead}>Written steps</legend>
        {v.steps.length === 0 && <p className={styles.muted}>No written steps yet.</p>}
        <ol className={styles.writtenList}>
          {v.steps.map((s, i) => (
            <li key={i} className={styles.writtenRow}>
              <span className={styles.writtenNo} aria-hidden="true">
                {i + 1}
              </span>
              <TextInput
                aria-label={`Written step ${i + 1}: action`}
                placeholder="What to do"
                value={s.action}
                onChange={(e) => setStep(i, 'action', e.target.value)}
              />
              <TextInput
                aria-label={`Written step ${i + 1}: expected result`}
                placeholder="What should happen (optional)"
                value={s.expected}
                onChange={(e) => setStep(i, 'expected', e.target.value)}
              />
              <span className={styles.writtenTools}>
                <IconButton
                  icon="up"
                  label={`Move written step ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => moveStep(i, -1)}
                />
                <IconButton
                  icon="down"
                  label={`Move written step ${i + 1} down`}
                  disabled={i === v.steps.length - 1}
                  onClick={() => moveStep(i, 1)}
                />
                <IconButton
                  icon="trash"
                  label={`Remove written step ${i + 1}`}
                  onClick={() => update({ ...v, steps: v.steps.filter((_, j) => j !== i) })}
                />
              </span>
            </li>
          ))}
        </ol>
        <div>
          <Button
            size="sm"
            icon="plus"
            onClick={() => update({ ...v, steps: [...v.steps, { action: '', expected: '' }] })}
          >
            Add step
          </Button>
        </div>
      </fieldset>
      <Field label="Expected result" error={errors['expectedResult']}>
        {(p) => (
          <TextArea {...p} rows={2} value={v.expectedResult} onChange={set('expectedResult')} />
        )}
      </Field>
      <div className={styles.formActions}>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          disabled={!v.title.trim() || !tc.testSuiteId}
        >
          Save changes
        </Button>
      </div>
    </form>
  );
}
