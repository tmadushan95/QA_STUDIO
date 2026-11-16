/**
 * StepEditor: the visual editor for a test case's steps (or for the body of a custom step).
 *
 * Each step is a card. Its header says what the step does as a sentence ("Click button “Delete” in the dialog"), with
 * each value highlighted, parameters shown as chips and missing required values called out, plus its status in words
 * (problems, notes, "Changes data"). The body, which can be hidden, holds "What should this step do?" (the action) and
 * the action's fields, each with its label above it. Steps can be added, moved, duplicated and removed; problems found
 * by the server are shown on the step they belong to, also while it is hidden.
 *
 * Every action is edited as a form: standard steps and a project's custom steps declare their fields, and application
 * steps get theirs from their parameter schema. Only settings no form can show (a nested structure) are offered as
 * "Extra settings", never the whole step as JSON. Parameters are picked from a list and shown as chips; they are
 * still stored as `{{data.name}}` (see ParameterPicker).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Icon,
  IconButton,
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
import type { Step, StepCheck } from '../api.js';
import { TokenText, ValueField, type TextFieldProps } from './ParameterPicker.js';
import { singleToken } from './parameterTokens.js';
import { TargetField, type Target } from './TargetField.js';
import styles from './StepEditor.module.css';

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

/** What a token inserted by the parameter picker looks like: a case parameter, or a custom step's input. */
export type TokenKind = 'data' | 'input';

/** Props of `StepEditor`. */
export interface StepEditorProps {
  steps: Step[];
  onChange: (steps: Step[]) => void;
  actions: ActionInfo[];
  pages: PageEntry[];
  /** Names the parameter picker offers: the case's parameters, or (in a custom step) its inputs. */
  dataNames: string[];
  /** Saved values of the case's parameters, previewed on their chips. Leave out when they are not known. */
  values?: Record<string, string> | undefined;
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

/** Which control gets focus after a change that re-renders the list (moving, adding or deleting a step). */
type FocusTarget = { step: number; control: 'up' | 'down' | 'action' | 'toggle' } | 'add';

/** Edits a list of steps as fields, with problems shown on each step. */
export function StepEditor({
  steps,
  onChange,
  actions,
  pages,
  dataNames,
  values,
  tokenKind = 'data',
  checks,
}: StepEditorProps) {
  const root = useRef<HTMLDivElement>(null);
  const focusNext = useRef<FocusTarget | null>(null);
  // Hidden steps, by index; kept in step with the list when steps move, are duplicated or are deleted.
  const [hidden, setHidden] = useState<boolean[]>([]);
  const byName = new Map(actions.map((a) => [a.name, a]));
  const used = new Set(steps.map((s) => s.action));
  // Application steps are written for one application's code. They stay usable where a case already has them, but are
  // not offered for new steps: a project defines what it needs as custom steps instead.
  const offered = actions.filter((a) => a.ui?.group !== 'Application' || used.has(a.name));
  const update = (i: number, next: Step) => onChange(steps.map((s, j) => (j === i ? next : s)));
  const isHidden = (i: number) => hidden[i] === true;
  const allHidden = steps.length > 0 && steps.every((_, i) => isHidden(i));

  // Rows are keyed by position, so after a change focus is put back on the control the person used, at its new place.
  useEffect(() => {
    const next = focusNext.current;
    const el = root.current;
    if (!next || !el) return;
    focusNext.current = null;
    const find = (sel: string) => el.querySelector<HTMLElement>(sel);
    const target =
      next === 'add'
        ? find('[data-add]')
        : find(`[data-step="${next.step}"] [data-control="${next.control}"]`);
    if (target && !(target as HTMLButtonElement).disabled) target.focus();
    else if (next !== 'add') find(`[data-step="${next.step}"] [data-control="toggle"]`)?.focus();
  });

  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j]!, next[i]!];
    const h = steps.map((_, k) => isHidden(k));
    [h[i], h[j]] = [h[j]!, h[i]!];
    setHidden(h);
    focusNext.current = { step: j, control: by < 0 ? 'up' : 'down' };
    onChange(next);
  };
  const add = () => {
    setHidden([...steps.map((_, k) => isHidden(k)), false]);
    focusNext.current = { step: steps.length, control: 'action' };
    onChange([...steps, blankStep(actions)]);
  };
  const duplicate = (i: number) => {
    const h = steps.map((_, k) => isHidden(k));
    setHidden([...h.slice(0, i + 1), false, ...h.slice(i + 1)]);
    focusNext.current = { step: i + 1, control: 'action' };
    onChange([...steps.slice(0, i + 1), structuredClone(steps[i]!), ...steps.slice(i + 1)]);
  };
  const remove = (i: number) => {
    setHidden(steps.map((_, k) => isHidden(k)).filter((_, k) => k !== i));
    focusNext.current =
      steps.length > 1 ? { step: Math.min(i, steps.length - 2), control: 'toggle' } : 'add';
    onChange(steps.filter((_, j) => j !== i));
  };

  return (
    <div ref={root} className={styles.editor}>
      {steps.length === 0 ? (
        <p className={styles.noSteps}>No steps yet. Add the first one below.</p>
      ) : (
        <>
          {steps.length > 1 && (
            <div className={styles.toolbar}>
              <span className={styles.count}>{steps.length} steps, run from top to bottom</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setHidden(steps.map(() => !allHidden))}
              >
                {allHidden ? 'Show all details' : 'Hide all details'}
              </Button>
            </div>
          )}
          <ol className={styles.list} aria-label="Steps">
            {steps.map((s, i) => (
              <StepRow
                key={i}
                index={i}
                count={steps.length}
                step={s}
                info={byName.get(s.action)}
                actions={offered}
                pages={pages}
                dataNames={dataNames}
                values={values}
                tokenKind={tokenKind}
                check={checks.find((c) => c.index === i)}
                collapsed={isHidden(i)}
                onToggle={() =>
                  setHidden(steps.map((_, k) => (k === i ? !isHidden(k) : isHidden(k))))
                }
                onMove={(by) => move(i, by)}
                onChange={(next) => update(i, next)}
                menu={
                  <Menu
                    label={`Step ${i + 1} actions`}
                    items={[
                      { label: 'Duplicate', icon: 'copy', onSelect: () => duplicate(i) },
                      {
                        label: 'Delete step',
                        icon: 'trash',
                        danger: true,
                        onSelect: () => remove(i),
                      },
                    ]}
                  />
                }
              />
            ))}
          </ol>
        </>
      )}
      <div className={styles.addRow}>
        <Button icon="plus" data-add onClick={add}>
          Add step
        </Button>
      </div>
    </div>
  );
}

interface StepRowProps {
  index: number;
  count: number;
  step: Step;
  info: ActionInfo | undefined;
  actions: ActionInfo[];
  pages: PageEntry[];
  dataNames: string[];
  values: Record<string, string> | undefined;
  tokenKind: TokenKind;
  check: StepCheck | undefined;
  collapsed: boolean;
  onToggle: () => void;
  onMove: (by: number) => void;
  onChange: (next: Step) => void;
  menu: ReactNode;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function StepRow({
  index,
  count,
  step,
  info,
  actions,
  pages,
  dataNames,
  values,
  tokenKind,
  check,
  collapsed,
  onToggle,
  onMove,
  onChange,
  menu,
}: StepRowProps) {
  const n = index + 1;
  const bodyId = useId();
  const issues = check?.issues ?? [];
  const warnings = check?.warnings ?? [];
  const fields = info?.ui?.fields ?? [];
  const setParam = (name: string, value: unknown) => {
    const params = { ...step.params };
    if (value === undefined || value === '') delete params[name];
    else params[name] = value;
    onChange({ ...step, params });
  };

  // A text box that can hold parameters: shown as chips, picked from a list (see ParameterPicker).
  const textField = (p: TextFieldProps) => (
    <ValueField {...p} kind={tokenKind} names={dataNames} values={values} />
  );

  // Settings no form field covers (a nested structure an application step takes).
  const covered = new Set(fields.map((f) => f.name));
  const extra = Object.fromEntries(Object.entries(step.params).filter(([k]) => !covered.has(k)));
  const hasExtra = Object.keys(extra).length > 0;
  const hasStatus = issues.length > 0 || warnings.length > 0 || info?.destructive;

  // What the step does in plain words: the card's title while its details are hidden, its preview while shown.
  const sentence = info?.ui ? (
    <p className={styles.sentence}>
      {sentenceParts(info, step.params).map((p, i) =>
        typeof p === 'string' ? (
          p
        ) : (
          <SentenceValue key={i} field={p.field} value={p.value} values={values} />
        ),
      )}
    </p>
  ) : (
    <p className={styles.sentence}>
      This step is not available in this project. Pick another action, or add it as a custom step in
      Project settings.
    </p>
  );

  // "What should this step do?": first thing in a shown card, so it reads choose → fill in → check the preview.
  const actionPicker = (
    <div className={styles.field}>
      <span className={styles.fieldLabel} aria-hidden="true">
        What should this step do?
      </span>
      <Select
        aria-label={`Step ${n}: action`}
        data-control="action"
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
    </div>
  );

  return (
    <li
      className={issues.length ? `${styles.row} ${styles.invalid}` : styles.row}
      data-step={index}
    >
      <div className={styles.head}>
        <span className={styles.number}>
          <span className="visually-hidden">Step </span>
          {n}
        </span>
        <div className={styles.summary}>
          {collapsed ? sentence : actionPicker}
          {hasStatus && (
            <div className={styles.status}>
              {issues.length > 0 && (
                <Badge tone="danger" glyph="✕">
                  {plural(issues.length, 'problem')}
                </Badge>
              )}
              {warnings.length > 0 && (
                <Badge tone="warning" glyph="!">
                  {plural(warnings.length, 'note')}
                </Badge>
              )}
              {info?.destructive && (
                <span title="Runs only where deleting is allowed">
                  <Badge tone="danger" glyph="⚠">
                    Changes data
                  </Badge>
                </span>
              )}
            </div>
          )}
        </div>
        <div className={styles.controls}>
          <IconButton
            icon="up"
            label={`Move step ${n} up`}
            data-control="up"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          />
          <IconButton
            icon="down"
            label={`Move step ${n} down`}
            data-control="down"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          />
          {/* A worded disclosure, so it is not mistaken for the "move down" chevron next to it. */}
          <Button
            size="sm"
            variant="ghost"
            icon="right"
            aria-label={`Step ${n} details`}
            data-control="toggle"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            className={styles.toggle}
            onClick={onToggle}
          >
            Details
          </Button>
          {menu}
        </div>
      </div>

      <div id={bodyId} className={styles.body} hidden={collapsed}>
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
                  textField={textField}
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
                for (const k of covered)
                  if (step.params[k] !== undefined) params[k] = step.params[k];
                onChange({ ...step, params });
              }}
            />
          </details>
        )}
        <div className={styles.result}>
          <span className={styles.resultLabel}>What this step does</span>
          {!collapsed && sentence}
        </div>
      </div>

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

/** One value inside a step's sentence, highlighted; parameters show as chips, a missing required value says so. */
function SentenceValue({
  field,
  value,
  values,
}: {
  field: ActionField | undefined;
  value: unknown;
  values: Record<string, string> | undefined;
}) {
  if (field?.kind === 'target') {
    return (
      <span className={styles.value}>
        <TokenText text={describeElement(value as Target | undefined)} values={values} />
      </span>
    );
  }
  if (value === undefined || value === '') {
    return field?.required ? (
      <span className={styles.missing}>{field.label} missing</span>
    ) : (
      <span className={styles.empty}>…</span>
    );
  }
  if (typeof value === 'boolean')
    return <span className={styles.value}>{value ? 'yes' : 'no'}</span>;
  const text = String(value);
  // A number, or a value that is only a parameter, needs no quotes around it.
  const bare = field?.kind === 'number' || singleToken(text) !== undefined;
  return (
    <span className={styles.value}>
      {bare ? '' : '“'}
      <TokenText text={text} values={values} />
      {bare ? '' : '”'}
    </span>
  );
}

/**
 * A step in plain words as text, for places that list steps without editing them, such as an AI proposal shown next
 * to the current steps. An action the catalog does not know shows by its name.
 */
export function stepSentence(info: ActionInfo | undefined, step: Step): string {
  if (!info) return step.action;
  const parts = sentenceParts(info, step.params);
  return parts
    .map((p, i) => {
      if (typeof p === 'string') return p;
      if (p.field?.kind === 'target') return describeElement(p.value as Target | undefined);
      if (p.value === undefined || p.value === '') return '…';
      if (typeof p.value === 'object') return JSON.stringify(p.value);
      // A summary such as 'Check “{text}” is shown' already quotes the value.
      const before = parts[i - 1];
      const quoted = typeof before === 'string' && before.endsWith('“');
      return quoted ? String(p.value) : `“${String(p.value)}”`;
    })
    .join('');
}

/** A piece of a step's sentence: words, or one of the step's values. */
type SentencePart = string | { field: ActionField | undefined; value: unknown };

/** The step in plain words, for example `Fill field “Code” with` + the Code value. */
function sentenceParts(info: ActionInfo, params: Record<string, unknown>): SentencePart[] {
  const ui = info.ui;
  if (!ui) return [info.name];
  const byName = new Map(ui.fields.map((f) => [f.name, f]));
  if (/\{\w+\}/.test(ui.summary)) {
    const parts: SentencePart[] = [];
    let last = 0;
    for (const m of ui.summary.matchAll(/\{(\w+)\}/g)) {
      if (m.index > last) parts.push(ui.summary.slice(last, m.index));
      parts.push({ field: byName.get(m[1]!), value: params[m[1]!] });
      last = m.index + m[0].length;
    }
    if (last < ui.summary.length) parts.push(ui.summary.slice(last));
    const first = parts[0];
    if (typeof first === 'string') parts[0] = first.charAt(0).toUpperCase() + first.slice(1);
    return parts;
  }
  // Custom and application steps: the step's name, then the inputs that are filled in.
  const given = ui.fields.filter((f) => params[f.name] !== undefined && params[f.name] !== '');
  if (given.length === 0) return [ui.label];
  const parts: SentencePart[] = [`${ui.label} — `];
  given.forEach((f, i) => {
    parts.push(`${i > 0 ? ', ' : ''}${f.label}: `, { field: f, value: params[f.name] });
  });
  return parts;
}

interface FieldInputProps {
  field: ActionField;
  step: number;
  value: unknown;
  pages: PageEntry[];
  /** Inside a custom step: its input names, which a page or number field may take instead of a fixed value. */
  inputs?: string[] | undefined;
  onChange: (value: unknown) => void;
  textField: (props: TextFieldProps) => ReactNode;
}

/** One input of a step, chosen by the field's kind. */
function FieldInput({ field, step, value, pages, inputs, onChange, textField }: FieldInputProps) {
  const name = `Step ${step}: ${field.label}`;
  switch (field.kind) {
    case 'target':
      return (
        <TargetField
          step={step}
          label={field.label}
          value={value as Target | undefined}
          onChange={onChange}
          textField={textField}
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
        textField({
          label: name,
          placeholder: 'A number, or an input',
          value: value === undefined ? '' : String(value),
          replace: true,
          onChange: (v) => onChange(v === '' ? undefined : /^[0-9]+$/.test(v) ? Number(v) : v),
        })
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
      return field.kind === 'text' ? (
        textField({
          label: name,
          placeholder: field.help ?? field.label,
          value: String(value ?? ''),
          onChange,
        })
      ) : (
        <TextInput
          aria-label={name}
          placeholder={field.help ?? field.label}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
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
