/**
 * Project settings › Custom steps: steps a project defines for itself, so the step editor works for any application
 * without code. A custom step is a recipe: **inputs** (what a test case fills in) and a **body** of standard steps that can
 * use those inputs. Once saved it appears in every step list of the project, under "Custom steps of this project".
 *
 * Example: "Check a permission" with inputs Role and Permission, whose body opens the Roles page, clicks the role and
 * checks that the permission is shown. Test cases then only say which role and which permission.
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Icon,
  IconButton,
  Menu,
  Panel,
  Select,
  TextArea,
  TextInput,
  useToast,
} from '../../design-system/index.js';
import { useCatalog } from '../../shared/api/catalog.js';
import { ApiError, errorMessage } from '../../shared/api/http.js';
import { useResource } from '../../shared/hooks/useAsync.js';
import { plural } from '../../shared/lib/format.js';
import { StepEditor } from '../test-cases/components/StepEditor.js';
import { StepGuide } from '../test-cases/components/StepGuide.js';
import {
  definitionOf,
  EXAMPLE_STEP,
  fetchCustomSteps,
  inputName,
  saveCustomSteps,
  stepKey,
  type CustomInput,
  type CustomStep,
  type CustomStepView,
} from './customStepsApi.js';
import { useProjectScope } from './ProjectScope.js';
import styles from './CustomSteps.module.css';

const KINDS: { value: CustomInput['kind']; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'choice', label: 'Choose from a list' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'page', label: 'A page of the application' },
];

/** The project's custom steps, with a form to add, edit and delete them. */
export function CustomStepsSection() {
  const toast = useToast();
  const { project } = useProjectScope();
  const projectId = project?.id ?? 0;
  const data = useResource(
    () => (projectId ? fetchCustomSteps(projectId) : Promise.resolve([])),
    [projectId],
  );
  /** `null` is the "new" form; a step is that step's edit form. */
  const [editing, setEditing] = useState<{ step: CustomStep | null; isNew: boolean }>();
  const [deleting, setDeleting] = useState<CustomStepView>();
  const [busy, setBusy] = useState(false);
  const items = data.data ?? [];

  /** Save the whole list with one change applied. Throws the server's message when it refuses. */
  const apply = async (next: CustomStep[]) => {
    const saved = await saveCustomSteps(projectId, next);
    data.set(saved);
  };

  const remove = async (s: CustomStepView) => {
    setBusy(true);
    try {
      await apply(items.filter((x) => x.key !== s.key).map(definitionOf));
      toast.show(`Deleted “${s.label}”.`);
      setDeleting(undefined);
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' });
      setDeleting(undefined);
    } finally {
      setBusy(false);
    }
  };

  const oldWorker = /older than the web app|route-not-found/.test(data.error ?? '');

  return (
    <>
      <Panel
        title="Custom steps"
        description="Steps this project defines for itself, built from the standard steps. Use them in any test case of the project."
        actions={
          <Button
            icon="plus"
            variant="primary"
            disabled={!projectId}
            onClick={() => setEditing({ step: null, isNew: true })}
          >
            New custom step
          </Button>
        }
      >
        <div className={styles.stack}>
          <StepGuide variant="recipe" />
          {data.error && (
            <Alert tone={oldWorker ? 'warning' : 'danger'}>
              {oldWorker
                ? 'The test runner needs a restart to offer custom steps: stop it and run “npm run worker” in Backend/Worker, then reload this page.'
                : data.error}
            </Alert>
          )}
          {!data.error && items.length === 0 && !data.loading && (
            <EmptyState
              icon="design"
              title="No custom steps yet"
              action={
                <Button onClick={() => setEditing({ step: EXAMPLE_STEP, isNew: true })}>
                  Start from an example
                </Button>
              }
            >
              Standard steps already cover clicking, typing, waiting and checking in any
              application. Add a custom step when the same few steps keep repeating in your test
              cases.
            </EmptyState>
          )}
          {items.length > 0 && (
            <ul className={styles.grid} aria-label="Custom steps">
              {items.map((s) => (
                <li key={s.key} className={styles.card}>
                  <div className={styles.cardHead}>
                    <h3 className={styles.cardTitle}>{s.label}</h3>
                    <Menu
                      label={`Actions for ${s.label}`}
                      items={[
                        {
                          label: 'Edit',
                          icon: 'cases',
                          onSelect: () => setEditing({ step: s, isNew: false }),
                        },
                        {
                          label: 'Duplicate',
                          icon: 'copy',
                          onSelect: () =>
                            setEditing({
                              step: {
                                ...definitionOf(s),
                                key: stepKey(`${s.label} copy`),
                                label: `${s.label} (copy)`,
                              },
                              isNew: true,
                            }),
                        },
                        {
                          label: 'Delete',
                          icon: 'trash',
                          danger: true,
                          disabled: s.usedBy > 0,
                          onSelect: () => setDeleting(s),
                        },
                      ]}
                    />
                  </div>
                  {s.description && <p className={styles.muted}>{s.description}</p>}
                  <div className={styles.chips}>
                    {s.inputs.length === 0 ? (
                      <span className={styles.muted}>No inputs</span>
                    ) : (
                      s.inputs.map((i) => (
                        <Badge key={i.name} tone="info">
                          {i.label}
                        </Badge>
                      ))
                    )}
                  </div>
                  <p className={styles.facts}>
                    <span>{plural(s.steps.length, 'step')}</span>
                    <span>
                      {s.usedBy > 0 ? `Used by ${plural(s.usedBy, 'test case')}` : 'Not used yet'}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
      {editing && (
        <CustomStepDialog
          projectId={projectId}
          step={editing.step}
          isNew={editing.isNew}
          taken={items.map((s) => s.key)}
          onClose={() => setEditing(undefined)}
          onSave={async (def) => {
            const others = items.filter(
              (x) => x.key !== (editing.isNew ? def.key : editing.step?.key),
            );
            await apply([...others.map(definitionOf), def]);
            toast.show(`Saved “${def.label}”. Test cases can use it now.`);
            setEditing(undefined);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.label}”?`}
          confirmLabel="Delete custom step"
          danger
          busy={busy}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => void remove(deleting)}
        >
          No test case uses it. This cannot be undone.
        </ConfirmDialog>
      )}
    </>
  );
}

/** A row of the inputs editor; `auto` while its name still follows its label. */
type InputRow = CustomInput & { auto: boolean };

interface CustomStepDialogProps {
  projectId: number;
  /** The step to edit or start from; null for a blank one. */
  step: CustomStep | null;
  isNew: boolean;
  /** Names already taken in this project. */
  taken: string[];
  onClose: () => void;
  onSave: (def: CustomStep) => Promise<void>;
}

/** The form for one custom step: name, inputs, steps, and a preview of how it looks when used. */
function CustomStepDialog({
  projectId,
  step,
  isNew,
  taken,
  onClose,
  onSave,
}: CustomStepDialogProps) {
  const catalog = useCatalog(projectId);
  const [label, setLabel] = useState(step?.label ?? '');
  const [key, setKey] = useState(step?.key ?? '');
  const [keyAuto, setKeyAuto] = useState(!step || isNew);
  const [description, setDescription] = useState(step?.description ?? '');
  const [inputs, setInputs] = useState<InputRow[]>(
    (step?.inputs ?? []).map((i) => ({ ...i, auto: false })),
  );
  const [body, setBody] = useState(step?.steps ?? []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const definition = (): CustomStep => ({
    key,
    label: label.trim(),
    ...(description.trim() && { description: description.trim() }),
    inputs: inputs.map((i) => ({
      name: i.name,
      label: i.label,
      kind: i.kind,
      required: i.required,
      ...(i.kind === 'choice' && i.options && { options: i.options }),
      ...(i.help && { help: i.help }),
    })),
    steps: body,
  });
  const dirty =
    JSON.stringify(definition()) !== JSON.stringify(step ? { ...step, inputs: step.inputs } : {});
  const clash = isNew && taken.includes(key);
  const names = inputs.map((i) => i.name);

  const setInput = (i: number, patch: Partial<InputRow>) =>
    setInputs(inputs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await onSave(definition());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : errorMessage(e));
      setBusy(false);
    }
  };

  // The recipe's body may use only the standard steps.
  const standard = (catalog?.actions ?? []).filter((a) => a.source === 'generic');

  return (
    <Dialog
      title={isNew ? 'New custom step' : `Edit “${step?.label ?? ''}”`}
      subtitle="A reusable recipe of steps for this project"
      size="lg"
      dirty={dirty}
      onClose={onClose}
      onSave={() => void save()}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!label.trim() || !key || clash || body.length === 0}
            onClick={() => void save()}
          >
            Save custom step
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {error && <Alert tone="danger">{error}</Alert>}

        <section className={styles.section} aria-label="Name">
          <h3 className={styles.sectionTitle}>
            <span>1</span> What is it called?
          </h3>
          <div className={styles.two}>
            <Field
              label="Name"
              required
              hint="How it appears in the step list, for example “Check a permission”."
            >
              {(p) => (
                <TextInput
                  {...p}
                  data-autofocus
                  value={label}
                  maxLength={80}
                  onChange={(e) => {
                    setLabel(e.target.value);
                    if (keyAuto) setKey(stepKey(e.target.value));
                  }}
                />
              )}
            </Field>
            <Field
              label="Short name"
              required
              hint={
                clash ? undefined : 'Lowercase, used inside the project. Cannot change once saved.'
              }
              error={
                clash ? 'This project already has a custom step with this short name.' : undefined
              }
            >
              {(p) => (
                <TextInput
                  {...p}
                  value={key}
                  disabled={!isNew}
                  maxLength={48}
                  onChange={(e) => {
                    setKeyAuto(false);
                    setKey(e.target.value.toLowerCase());
                  }}
                />
              )}
            </Field>
          </div>
          <Field label="What does it do?" hint="Optional. Shown to people choosing the step.">
            {(p) => (
              <TextArea
                {...p}
                rows={2}
                value={description}
                maxLength={500}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>
        </section>

        <section className={styles.section} aria-label="Inputs">
          <h3 className={styles.sectionTitle}>
            <span>2</span> What do test cases fill in?
          </h3>
          <p className={styles.muted}>
            Each input becomes a field when the step is used. Leave this empty if the step always
            does exactly the same thing.
          </p>
          {inputs.length > 0 && (
            <ul className={styles.inputs} aria-label="Inputs">
              {inputs.map((i, n) => (
                <li key={n} className={styles.inputRow}>
                  <TextInput
                    aria-label={`Input ${n + 1}: label`}
                    placeholder="Label, e.g. Role"
                    value={i.label}
                    maxLength={80}
                    onChange={(e) =>
                      setInput(n, {
                        label: e.target.value,
                        ...(i.auto && { name: inputName(e.target.value) }),
                      })
                    }
                  />
                  <TextInput
                    aria-label={`Input ${n + 1}: name used in steps`}
                    className={styles.mono}
                    placeholder="name"
                    value={i.name}
                    maxLength={64}
                    onChange={(e) => setInput(n, { name: e.target.value, auto: false })}
                  />
                  <Select
                    aria-label={`Input ${n + 1}: type`}
                    value={i.kind}
                    onChange={(e) => setInput(n, { kind: e.target.value as CustomInput['kind'] })}
                  >
                    {KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </Select>
                  <Checkbox
                    label="Required"
                    checked={i.required}
                    onChange={(e) => setInput(n, { required: e.target.checked })}
                  />
                  <IconButton
                    icon="trash"
                    label={`Remove input ${n + 1}`}
                    onClick={() => setInputs(inputs.filter((_, j) => j !== n))}
                  />
                  {i.kind === 'choice' && (
                    <TextInput
                      aria-label={`Input ${n + 1}: choices`}
                      className={styles.wideCell}
                      placeholder="Choices, separated by commas, e.g. Admin, Viewer"
                      value={(i.options ?? []).join(', ')}
                      onChange={(e) =>
                        setInput(n, {
                          options: e.target.value
                            .split(',')
                            .map((o) => o.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button
              icon="plus"
              onClick={() =>
                setInputs([
                  ...inputs,
                  { name: '', label: '', kind: 'text', required: true, auto: true },
                ])
              }
            >
              Add input
            </Button>
          </div>
        </section>

        <section className={styles.section} aria-label="Steps">
          <h3 className={styles.sectionTitle}>
            <span>3</span> What does it do?
          </h3>
          <p className={styles.muted}>
            The steps run in order each time the custom step is used.
            {names.length > 0 && (
              <>
                {' '}
                Press <code>{'{ }'}</code> in a text box to use an input there.
              </>
            )}
          </p>
          {catalog ? (
            <StepEditor
              steps={body}
              onChange={setBody}
              actions={standard}
              pages={catalog.pages}
              dataNames={names.filter(Boolean)}
              tokenKind="input"
              checks={[]}
            />
          ) : (
            <p className={styles.muted}>Loading the steps…</p>
          )}
        </section>

        <section className={styles.preview} aria-label="Preview">
          <h3 className={styles.previewTitle}>
            <Icon name="info" size={14} /> How it will look in a test case
          </h3>
          <div className={styles.previewCard}>
            <strong>{label.trim() || 'Your custom step'}</strong>
            {inputs.length === 0 ? (
              <span className={styles.muted}>Nothing to fill in.</span>
            ) : (
              <div className={styles.previewFields}>
                {inputs.map((i, n) => (
                  <span key={n} className={styles.previewField}>
                    <span className={styles.muted}>{i.label || `Input ${n + 1}`}</span>
                    <span className={styles.fake}>
                      {i.kind === 'choice'
                        ? (i.options?.[0] ?? 'Choose…')
                        : i.kind === 'boolean'
                          ? '☐'
                          : '…'}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
