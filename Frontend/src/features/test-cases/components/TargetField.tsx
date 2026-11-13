/**
 * TargetField: picks an element the way a tester describes it — "Button named Delete inside the row containing
 * PRJ-1" — and turns that into the step's `target`. No CSS selectors are ever shown or needed.
 */
import type { ReactNode } from 'react';
import { Select, TextInput } from '../../../design-system/index.js';
import styles from './StepEditor.module.css';

/** The stored shape of a target (matches the server's Target schema). */
export interface Target {
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  testId?: string;
  exact?: boolean;
  within?: { role?: string; name?: string; text?: string; testId?: string };
  nth?: number;
}

/** "Find by" choices, in the order testers reach for them. */
const FIND_BY: { value: string; label: string }[] = [
  { value: 'role:button', label: 'Button' },
  { value: 'role:link', label: 'Link' },
  { value: 'label', label: 'Field labelled' },
  { value: 'text', label: 'Text' },
  { value: 'role:heading', label: 'Heading' },
  { value: 'role:checkbox', label: 'Checkbox' },
  { value: 'role:tab', label: 'Tab' },
  { value: 'role:menuitem', label: 'Menu item' },
  { value: 'role:dialog', label: 'Dialog' },
  { value: 'role:row', label: 'Table row' },
  { value: 'role:alert', label: 'Message (alert)' },
  { value: 'role:combobox', label: 'Drop-down' },
  { value: 'placeholder', label: 'Field with placeholder' },
  { value: 'testId', label: 'Test id' },
];

const WITHIN: { value: string; label: string }[] = [
  { value: '', label: 'Anywhere on the page' },
  { value: 'dialog', label: 'Inside the dialog' },
  { value: 'row', label: 'In the table row containing' },
  { value: 'region', label: 'In the section named' },
];

/** Which "Find by" choice a stored target corresponds to. */
function findByOf(t: Target): string {
  if (t.testId !== undefined) return 'testId';
  if (t.role) return `role:${t.role}`;
  if (t.label !== undefined) return 'label';
  if (t.placeholder !== undefined) return 'placeholder';
  return 'text';
}

/** The words of the target for the chosen "Find by". */
function wordsOf(t: Target): string {
  return t.testId ?? t.name ?? t.label ?? t.placeholder ?? t.text ?? '';
}

function build(findBy: string, words: string, within: Target['within']): Target {
  const w = words;
  const base: Target = findBy.startsWith('role:')
    ? { role: findBy.slice(5), ...(w && { name: w }) }
    : findBy === 'label'
      ? { label: w }
      : findBy === 'placeholder'
        ? { placeholder: w }
        : findBy === 'testId'
          ? { testId: w }
          : { text: w };
  return within ? { ...base, within } : base;
}

function withinOf(t: Target): { kind: string; words: string } {
  const w = t.within;
  if (!w) return { kind: '', words: '' };
  if (w.role === 'dialog') return { kind: 'dialog', words: w.name ?? '' };
  if (w.role === 'row') return { kind: 'row', words: w.text ?? '' };
  return { kind: 'region', words: w.name ?? '' };
}

function buildWithin(kind: string, words: string): Target['within'] {
  if (kind === 'dialog') return { role: 'dialog', ...(words && { name: words }) };
  if (kind === 'row') return { role: 'row', text: words || ' ' };
  if (kind === 'region') return { role: 'region', ...(words && { name: words }) };
  return undefined;
}

/** Props of `TargetField`. */
export interface TargetFieldProps {
  value: Target | undefined;
  onChange: (next: Target) => void;
  /** Step number, for accessible names ("Step 3: find by"). */
  step: number;
  /** Field label from the action, such as "Field" or "Element". */
  label: string;
  /** Insert-parameter helper, given by the step row. */
  dataPicker?: (insert: (token: string) => void) => ReactNode;
}

/** Describes the element a step acts on, the way a person would. */
export function TargetField({ value, onChange, step, label, dataPicker }: TargetFieldProps) {
  const t = value ?? {};
  const findBy = findByOf(t);
  const words = wordsOf(t);
  const within = withinOf(t);
  const set = (fb: string, w: string, wk = within.kind, ww = within.words) =>
    onChange(build(fb, w, buildWithin(wk, ww)));
  return (
    <div className={styles.target}>
      <Select
        aria-label={`Step ${step}: ${label}, find by`}
        value={findBy}
        onChange={(e) => set(e.target.value, words)}
        className={styles.findBy}
      >
        {FIND_BY.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </Select>
      <span className={styles.withData}>
        <TextInput
          aria-label={`Step ${step}: ${label}, name or text`}
          placeholder={
            findBy === 'label' ? 'Field label, e.g. Search' : 'Visible text, e.g. Delete'
          }
          value={words}
          onChange={(e) => set(findBy, e.target.value)}
        />
        {dataPicker?.((token) => set(findBy, `${words}${token}`))}
      </span>
      <Select
        aria-label={`Step ${step}: where`}
        value={within.kind}
        onChange={(e) => set(findBy, words, e.target.value, within.words)}
        className={styles.within}
      >
        {WITHIN.map((w) => (
          <option key={w.value} value={w.value}>
            {w.label}
          </option>
        ))}
      </Select>
      {within.kind && (
        <span className={styles.withData}>
          <TextInput
            aria-label={`Step ${step}: ${within.kind === 'row' ? 'row contains' : 'container name'}`}
            placeholder={within.kind === 'row' ? 'e.g. {{data.project}}' : 'optional'}
            value={within.words.trim()}
            onChange={(e) => set(findBy, words, within.kind, e.target.value)}
          />
          {dataPicker?.((token) =>
            set(findBy, words, within.kind, `${within.words.trim()}${token}`),
          )}
        </span>
      )}
    </div>
  );
}
