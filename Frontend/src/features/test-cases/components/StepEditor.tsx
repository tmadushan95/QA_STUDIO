/**
 * StepEditor: the visual editor for a test case's steps (or for the body of a custom step).
 *
 * Each step is a card: a numbered header with the action to perform, a one-line sentence saying what the step does in
 * plain words ("Click button “Delete” in the dialog"), then the action's fields, each with its label above it. Steps can
 * be added, duplicated, moved and removed; problems found by the server are shown on the step they belong to.
 *
 * Every action is edited as a form: standard steps and a project's custom steps declare their fields, and application
 * steps get theirs from their parameter schema. Only settings no form can show (a nested structure) are offered as
 * "Extra settings", never the whole step as JSON.
 */
import { useState, type ReactNode } from 'react';
import {
  Button,
  Checkbox,
  Icon,
  Menu,
  Select,
  TextArea,
  TextInput,
} from '../../../design-system/index.js';
import type {
  ActionField,
  ActionGroup,
  ActionInfo,
  PageEntry,
} from '../../../shared/api/catalog.js';
import { PARAMETER_NAME, type Step, type StepCheck } from '../api.js';
import { TargetField, type Target } from './TargetField.js';
import styles from './StepEditor.module.css';

/** The picker value that asks for a new parameter name instead of inserting an existing one. */
const NEW_PARAMETER = '__new__';

/** Menu order and headings of the action groups. */
const GROUPS: { id: ActionGroup; label: string }[] = [
  { id: 'Navigate', label: 'Go to a page' },
  { id: 'Interact', label: 'Do something' },
  { id: 'Wait', label: 'Wait' },
  { id: 'Check', label: 'Check the result' },
  { id: 'Remember', label: 'Remember a value' },
  { id: 'Custom', label: 'Custom steps of this project' },
  { id: 'Application', label: 'Application steps (older)' },
];

/** What a token inserted by the "{ }" picker looks like: a case parameter, or a custom step's input. */
export type TokenKind = 'data' | 'input';

/** Props of `StepEditor`. */
export interface StepEditorProps {
  steps: Step[];
  onChange: (steps: Step[]) => void;
  actions: ActionInfo[];
  pages: PageEntry[];
  /** Names the "{ }" picker offers: the case's parameters, or (in a custom step) its inputs. */
  dataNames: string[];
  /** `data` inserts `{{data.name}}` and may add a new parameter; `input` inserts `{{input.name}}` only. */
  tokenKind?: TokenKind;
  /** Server check results, by step index. */
  checks: StepCheck[];
}

/** A new step: the first generic action, with empty fields. */
const blankStep = (actions: ActionInfo[]): Step => {
  const first = actions.find((a) => a.name === 'click') ?? actions.find((a) => a.ui);
  return first?.name === 'click' || !first
    ? { action: 'click', params: { target: { role: 'button' } } }
    : { action: first.name, params: defaultsOf(first) };
};

/** The values a new step of an action starts with. */
function defaultsOf(info: ActionInfo | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of info?.ui?.fields ?? []) if (f.default !== undefined) out[f.name] = f.default;
  return out;
}

/** Edits a list of steps as fields, with problems shown on each step. */
export function StepEditor({
  steps,
  onChange,
  actions,
  pages,
  dataNames,
  tokenKind = 'data',
  checks,
}: StepEditorProps) {
  const byName = new Map(actions.map((a) => [a.name, a]));
  const used = new Set(steps.map((s) => s.action));
  // Application steps are written for one application's code. They stay usable where a case already has them, but are
  // not offered for new steps: a project defines what it needs as custom steps instead.
  const offered = actions.filter((a) => a.ui?.group !== 'Application' || used.has(a.name));
  const update = (i: number, next: Step) => onChange(steps.map((s, j) => (j === i ? next : s)));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };

  return (
    <div className={styles.editor}>
      {steps.length === 0 ? (
        <p className={styles.noSteps}>No steps yet. Add the first one below.</p>
      ) : (
        <ol className={styles.list} aria-label="Steps">
          {steps.map((s, i) => (
            <StepRow
              key={i}
              index={i}
              step={s}
              info={byName.get(s.action)}
              actions={offered}
              pages={pages}
              dataNames={dataNames}
              tokenKind={tokenKind}
              check={checks.find((c) => c.index === i)}
              onChange={(next) => update(i, next)}
              menu={
                <Menu
                  label={`Step ${i + 1} actions`}
                  items={[
                    {
                      label: 'Move up',
                      icon: 'up',
                      disabled: i === 0,
                      onSelect: () => move(i, -1),
                    },
                    {
                      label: 'Move down',
                      icon: 'down',
                      disabled: i === steps.length - 1,
                      onSelect: () => move(i, 1),
                    },
                    {
                      label: 'Duplicate',
                      icon: 'copy',
                      onSelect: () =>
                        onChange([
                          ...steps.slice(0, i + 1),
                          structuredClone(s),
                          ...steps.slice(i + 1),
                        ]),
                    },
                    {
                      label: 'Delete step',
                      icon: 'trash',
                      danger: true,
                      onSelect: () => onChange(steps.filter((_, j) => j !== i)),
                    },
                  ]}
                />
              }
            />
          ))}
        </ol>
      )}
      <div className={styles.addRow}>
        <Button icon="plus" onClick={() => onChange([...steps, blankStep(actions)])}>
          Add step
        </Button>
      </div>
    </div>
  );
}

interface StepRowProps {
  index: number;
  step: Step;
  info: ActionInfo | undefined;
  actions: ActionInfo[];
  pages: PageEntry[];
  dataNames: string[];
  tokenKind: TokenKind;
  check: StepCheck | undefined;
  onChange: (next: Step) => void;
  menu: ReactNode;
}

function StepRow({
  index,
  step,
  info,
  actions,
  pages,
  dataNames,
  tokenKind,
  check,
  onChange,
  menu,
}: StepRowProps) {
  const n = index + 1;
  const issues = check?.issues ?? [];
  const warnings = check?.warnings ?? [];
  const fields = info?.ui?.fields ?? [];
  const setParam = (name: string, value: unknown) => {
    const params = { ...step.params };
    if (value === undefined || value === '') delete params[name];
    else params[name] = value;
    onChange({ ...step, params });
  };

  // "Insert parameter": a small list that adds {{data.name}} (or {{input.name}}) at the end of a text field. In a case,
  // "New parameter…" asks for a name, so a case can start using a value it never had; the value itself is set on the
  // Parameters tab.
  const dataPicker = (insert: (token: string) => void) => (
    <Select
      aria-label={`Step ${n}: insert ${tokenKind === 'input' ? 'input' : 'parameter'}`}
      value=""
      className={styles.dataPicker}
      onChange={(e) => {
        let name = e.target.value;
        if (name === NEW_PARAMETER) {
          name = (
            window.prompt('Name of the new parameter (letters, digits, - or _):') ?? ''
          ).trim();
          if (!PARAMETER_NAME.test(name)) return;
        }
        if (name) insert(`{{${tokenKind}.${name}}}`);
      }}
      title={tokenKind === 'input' ? 'Insert one of this step’s inputs' : 'Insert parameter'}
    >
      <option value="">{'{ }'}</option>
      {dataNames.map((d) => (
        <option key={d} value={d}>
          {d}
        </option>
      ))}
      {tokenKind === 'data' && <option value={NEW_PARAMETER}>＋ New parameter…</option>}
    </Select>
  );

  // Settings no form field covers (a nested structure an application step takes).
  const covered = new Set(fields.map((f) => f.name));
  const extra = Object.fromEntries(Object.entries(step.params).filter(([k]) => !covered.has(k)));
  const hasExtra = Object.keys(extra).length > 0;

  return (
    <li className={issues.length ? `${styles.row} ${styles.invalid}` : styles.row}>
      <div className={styles.head}>
        <span className={styles.number} aria-hidden="true">
          {n}
        </span>
        <Select
          aria-label={`Step ${n}: action`}
          value={step.action}
          className={styles.action}
          onChange={(e) => {
            const next = actions.find((a) => a.name === e.target.value);
            // Keep a target when switching between actions that both use one (Click → Check element is shown).
            const keep =
              next?.ui?.fields.some((f) => f.kind === 'target') && step.params['target']
                ? { target: step.params['target'] }
                : {};
            onChange({ action: e.target.value, params: { ...defaultsOf(next), ...keep } });
          }}
        >
          {GROUPS.map((g) => {
            const own = actions.filter((a) => a.ui?.group === g.id);
            return own.length === 0 ? null : (
              <optgroup key={g.id} label={g.label}>
                {own.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.ui!.label}
                  </option>
                ))}
              </optgroup>
            );
          })}
          {!info && <option value={step.action}>{step.action} (not available)</option>}
        </Select>
        {info?.destructive && (
          <span className={styles.danger} title="Runs only where deleting is allowed">
            <Icon name="alert" size={14} /> Changes data
          </span>
        )}
        <div className={styles.rowMenu}>{menu}</div>
      </div>

      {info?.ui ? (
        <p className={styles.sentence}>
          <Icon name="right" size={14} /> {sentence(info, step.params)}
        </p>
      ) : (
        <p className={styles.sentence}>
          This step is not available in this project. Pick another action, or add it as a custom
          step in Project settings.
        </p>
      )}

      {fields.length > 0 && (
        <div className={styles.fields}>
          {fields.map((f) => (
            <div
              key={f.name}
              className={f.kind === 'target' ? `${styles.field} ${styles.wide}` : styles.field}
            >
              {/* The inputs name themselves (aria-label); this is the visible heading above them. */}
              {f.kind !== 'boolean' && (
                <span className={styles.fieldLabel} aria-hidden="true">
                  {f.label}
                  {f.required && <abbr title="Required"> *</abbr>}
                </span>
              )}
              <FieldInput
                field={f}
                step={n}
                value={step.params[f.name]}
                pages={pages}
                inputs={tokenKind === 'input' ? dataNames : undefined}
                onChange={(v) => setParam(f.name, v)}
                dataPicker={dataPicker}
              />
              {f.help && f.kind !== 'boolean' && <span className={styles.help}>{f.help}</span>}
            </div>
          ))}
        </div>
      )}

      {hasExtra && (
        <details className={styles.extra}>
          <summary>Extra settings</summary>
          <p className={styles.help}>
            Settings this step has that the form cannot show. Edit them as JSON only if you know
            what they do.
          </p>
          <RawParams
            step={n}
            params={extra}
            onChange={(more) => {
              const params: Record<string, unknown> = { ...more };
              for (const k of covered) if (step.params[k] !== undefined) params[k] = step.params[k];
              onChange({ ...step, params });
            }}
          />
        </details>
      )}

      {(issues.length > 0 || warnings.length > 0) && (
        <ul className={styles.messages}>
          {issues.map((m) => (
            <li key={m} className={styles.issue}>
              <Icon name="alert" size={14} /> {m}
            </li>
          ))}
          {warnings.map((m) => (
            <li key={m} className={styles.warning}>
              <Icon name="info" size={14} /> {m}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** "button “Delete” in the dialog": an element in the words a tester would use. */
function describeElement(t: Target | undefined): string {
  if (!t) return 'an element';
  const what = t.testId
    ? `test id “${t.testId}”`
    : t.role
      ? `${t.role}${t.name ? ` “${t.name}”` : ''}`
      : t.label !== undefined
        ? `field “${t.label}”`
        : t.placeholder !== undefined
          ? `field with placeholder “${t.placeholder}”`
          : `text “${t.text ?? ''}”`;
  const w = t.within;
  const where = w
    ? w.role === 'row'
      ? ` in the row containing “${(w.text ?? '').trim()}”`
      : ` in the ${w.role === 'region' ? 'section' : (w.role ?? 'element')}${w.name ? ` “${w.name}”` : ''}`
    : '';
  return `${what}${where}`;
}

/** One value inside a sentence. */
function show(field: ActionField | undefined, value: unknown): string {
  if (field?.kind === 'target') return describeElement(value as Target | undefined);
  if (value === undefined || value === '') return '…';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return field?.kind === 'number' ? String(value) : `“${String(value)}”`;
}

/** The step in plain words, for example `Fill field “Code” with “{{data.projectCode}}”`. */
export function sentence(info: ActionInfo, params: Record<string, unknown>): string {
  const ui = info.ui;
  if (!ui) return info.name;
  const byName = new Map(ui.fields.map((f) => [f.name, f]));
  if (/\{\w+\}/.test(ui.summary)) {
    const out = ui.summary.replace(/\{(\w+)\}/g, (_m, name: string) =>
      show(byName.get(name), params[name]),
    );
    return out.charAt(0).toUpperCase() + out.slice(1);
  }
  // Custom and application steps: the step's name, then the inputs that are filled in.
  const given = ui.fields
    .filter((f) => params[f.name] !== undefined && params[f.name] !== '')
    .map((f) => `${f.label}: ${show(f, params[f.name])}`);
  return given.length ? `${ui.label} — ${given.join(', ')}` : ui.label;
}

interface FieldInputProps {
  field: ActionField;
  step: number;
  value: unknown;
  pages: PageEntry[];
  /** Inside a custom step: its input names, which a page or number field may take instead of a fixed value. */
  inputs?: string[] | undefined;
  onChange: (value: unknown) => void;
  dataPicker: (insert: (token: string) => void) => ReactNode;
}

/** One input of a step, chosen by the field's kind. */
function FieldInput({ field, step, value, pages, inputs, onChange, dataPicker }: FieldInputProps) {
  const name = `Step ${step}: ${field.label}`;
  switch (field.kind) {
    case 'target':
      return (
        <TargetField
          step={step}
          label={field.label}
          value={value as Target | undefined}
          onChange={onChange}
          dataPicker={dataPicker}
        />
      );
    case 'page':
      return (
        <Select
          aria-label={name}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Choose a page…</option>
          {pages.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} ({p.route})
            </option>
          ))}
          {inputs?.map((i) => (
            <option key={`in-${i}`} value={`{{input.${i}}}`}>
              The input “{i}”
            </option>
          ))}
          {typeof value === 'string' &&
            value &&
            !pages.some((p) => p.name === value) &&
            !value.startsWith('{{input.') && (
              <option value={value}>{value} (not in Settings › Pages)</option>
            )}
        </Select>
      );
    case 'choice':
      return (
        <Select
          aria-label={name}
          value={String(value ?? field.options?.[0] ?? '')}
          onChange={(e) => onChange(e.target.value)}
        >
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );
    case 'number':
      // In a custom step the number may be one of its inputs, which is text until the step runs.
      return inputs ? (
        <span className={styles.withData}>
          <TextInput
            aria-label={name}
            placeholder="A number, or an input"
            value={value === undefined ? '' : String(value)}
            onChange={(e) =>
              onChange(
                e.target.value === ''
                  ? undefined
                  : /^[0-9]+$/.test(e.target.value)
                    ? Number(e.target.value)
                    : e.target.value,
              )
            }
          />
          {dataPicker((token) => onChange(token))}
        </span>
      ) : (
        <TextInput
          aria-label={name}
          type="number"
          min={0}
          className={styles.narrow}
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'boolean':
      return (
        <Checkbox
          label={field.label}
          {...(field.help && { hint: field.help })}
          checked={value === true}
          onChange={(e) => onChange(e.target.checked || undefined)}
        />
      );
    default:
      return (
        <span className={styles.withData}>
          <TextInput
            aria-label={name}
            placeholder={field.help ?? field.label}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
          />
          {field.kind === 'text' &&
            dataPicker((token) => onChange(`${String(value ?? '')}${token}`))}
        </span>
      );
  }
}

/** Settings of a step that no form field covers, edited as JSON (applied only when it parses). */
function RawParams({
  step,
  params,
  onChange,
}: {
  step: number;
  params: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(params, null, 2));
  const [bad, setBad] = useState(false);
  return (
    <TextArea
      aria-label={`Step ${step}: extra settings (JSON)`}
      className={styles.raw}
      value={text}
      invalid={bad}
      onChange={(e) => {
        setText(e.target.value);
        try {
          const v: unknown = JSON.parse(e.target.value || '{}');
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            setBad(false);
            onChange(v as Record<string, unknown>);
          } else setBad(true);
        } catch {
          setBad(true);
        }
      }}
    />
  );
}
