/**
 * NewCaseDialog: create one test case by hand. Written steps are one per line; after saving, the editor opens so
 * the runnable steps can be added.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  Field,
  Select,
  TextArea,
  TextInput,
} from '../../../design-system/index.js';
import { ApiError, errorMessage } from '../../../shared/api/http.js';
import { SuitePicker, firstUsable, type Project, type TestSuite } from '../../master-data/index.js';
import { createCase, fetchNextCaseId, type TestCase } from '../api.js';

/** The form that creates one test case in a chosen test suite. */
export function NewCaseDialog({
  projects,
  suites,
  initialSuiteId,
  projectVersionId,
  onClose,
  onCreated,
}: {
  projects: Project[];
  suites: TestSuite[];
  /** The suite to start on, such as the one the list is filtered to. */
  initialSuiteId?: number | undefined;
  /** The version the case is written for; saved with the case in the same request. */
  projectVersionId?: number | undefined;
  onClose: () => void;
  onCreated: (tc: TestCase) => void;
}) {
  const [v, setV] = useState({
    id: '',
    title: '',
    module: '',
    priority: '',
    steps: '',
    expectedResult: '',
  });
  const [suiteId, setSuiteId] = useState(initialSuiteId ?? firstUsable(projects, suites)?.id ?? 0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // The ID the server suggests. While the field still shows it, no ID is sent and the server assigns the next
  // free one at creation, so a case created by someone else meanwhile can never cause a duplicate.
  const [suggested, setSuggested] = useState('');
  useEffect(() => {
    fetchNextCaseId().then(
      (r) => {
        setSuggested(r.id);
        setV((cur) => (cur.id ? cur : { ...cur, id: r.id }));
      },
      () => undefined,
    );
  }, []);
  const dirty = Object.entries(v).some(([k, x]) => (k === 'id' ? x !== suggested && !!x : !!x));
  const customId = v.id.trim() && v.id.trim() !== suggested ? v.id.trim() : undefined;
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    setError('');
    setErrors({});
    try {
      const tc = await createCase({
        ...(customId && { id: customId }),
        testSuiteId: suiteId,
        ...(projectVersionId && { projectVersionId }),
        title: v.title.trim(),
        ...(v.module.trim() && { module: v.module.trim() }),
        ...(v.priority && { priority: v.priority }),
        steps: v.steps
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        ...(v.expectedResult.trim() && { expectedResult: v.expectedResult.trim() }),
      });
      onCreated(tc);
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields);
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="New test case"
      size="md"
      dirty={dirty}
      onClose={onClose}
      onSave={() => void save()}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!v.title.trim() || !suiteId}
            onClick={() => void save()}
          >
            Create and add steps
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {error && Object.keys(errors).length === 0 && <Alert tone="danger">{error}</Alert>}
        <SuitePicker
          projects={projects}
          suites={suites}
          suiteId={suiteId}
          error={errors['testSuiteId']}
          onChange={setSuiteId}
        />
        <div
          style={{
            display: 'grid',
            gap: 'var(--space-4)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))',
          }}
        >
          <Field
            label="Test case ID"
            error={errors['id']}
            hint={
              customId
                ? 'Your own ID. It must not be used yet.'
                : 'Given automatically, always unique. Type to use your own.'
            }
          >
            {(p) => <TextInput {...p} value={v.id} placeholder="Automatic" onChange={set('id')} />}
          </Field>
          <Field label="Priority">
            {(p) => (
              <Select {...p} value={v.priority} onChange={set('priority')}>
                <option value="">Not set</option>
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Title" required error={errors['title']}>
          {(p) => <TextInput {...p} data-autofocus value={v.title} onChange={set('title')} />}
        </Field>
        <Field label="Module">
          {(p) => <TextInput {...p} value={v.module} onChange={set('module')} />}
        </Field>
        <Field
          label="Written steps"
          hint="One step per line. They are kept as the case's description; runnable steps are added next."
        >
          {(p) => <TextArea {...p} rows={5} value={v.steps} onChange={set('steps')} />}
        </Field>
        <Field label="Expected result">
          {(p) => (
            <TextArea {...p} rows={2} value={v.expectedResult} onChange={set('expectedResult')} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
