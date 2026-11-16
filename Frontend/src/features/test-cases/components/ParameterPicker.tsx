/**
 * Parameters in step fields, shown the way a tester thinks of them instead of as `{{data.name}}` syntax.
 *
 * - `ParameterChip`: a parameter as a labelled chip, with its current value when known ("roleName · Admin").
 * - `TokenText`: a stored value with every token shown as a chip.
 * - `ParameterPicker`: the "Use parameter" button and its searchable list, which can also create a new parameter.
 * - `ValueField`: a step's text field. A value that is just one parameter shows as a chip; text mixed with
 *   parameters keeps the text box, inserts at the cursor and previews the parameters underneath.
 *
 * Only display and editing change: values are still stored as `{{data.name}}` / `{{input.name}}`.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Icon, IconButton, TextInput } from '../../../design-system/index.js';
import { PARAMETER_NAME } from '../api.js';
import { singleToken, splitTokens, tokenOf } from './parameterTokens.js';
import type { TokenKind } from './StepEditor.js';
import styles from './ParameterPicker.module.css';

/** What the editor knows about the parameters a field can use. */
interface ParameterSource {
  kind: TokenKind;
  /** Names offered: the case's parameters, or a custom step's inputs. */
  names: string[];
  /** Saved values of case parameters, for previews. Leave out when unknown (they are then not shown). */
  values?: Record<string, string> | undefined;
}

/** A parameter as a chip: icon, name and (for a case parameter whose values are known) its current value. */
export function ParameterChip({
  kind,
  name,
  values,
}: {
  kind: TokenKind;
  name: string;
  values?: Record<string, string> | undefined;
}) {
  const showValue = kind === 'data' && values !== undefined;
  const value = showValue ? values[name] : undefined;
  return (
    <span className={styles.chip}>
      <Icon name="sliders" size={12} />
      <span className="visually-hidden">{kind === 'input' ? 'input ' : 'parameter '}</span>
      <span className={styles.chipName}>{name}</span>
      {/* Read as "parameter code: ABC"; the divider line stands in for the colon on screen. */}
      {showValue && <span className="visually-hidden">: </span>}
      {showValue &&
        (value ? (
          <span className={styles.chipValue}>{value}</span>
        ) : (
          // Said in words, not only by the muted style.
          <span className={`${styles.chipValue} ${styles.noValue}`}>no value yet</span>
        ))}
    </span>
  );
}

/** A stored value with each `{{…}}` token shown as a chip. */
export function TokenText({
  text,
  values,
}: {
  text: string;
  values?: Record<string, string> | undefined;
}) {
  return (
    <>
      {splitTokens(text).map((p, i) =>
        typeof p === 'string' ? (
          p
        ) : (
          <ParameterChip key={i} kind={p.kind} name={p.name} values={values} />
        ),
      )}
    </>
  );
}

/** Props of `ParameterPicker`. */
export interface ParameterPickerProps extends ParameterSource {
  /** Accessible name of the button; starts with its visible text, for example "Use parameter in Step 1: Role". */
  label: string;
  /** Visible text of the button. Defaults to "Use parameter" / "Use input". */
  text?: string;
  /** Called with the chosen (or newly named) parameter. */
  onPick: (name: string) => void;
}

/** "Use parameter": a button that opens a searchable list of parameters (a bottom sheet on phones). */
export function ParameterPicker({
  label,
  text,
  kind,
  names,
  values,
  onPick,
}: ParameterPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const noun = kind === 'input' ? 'input' : 'parameter';

  const q = query.trim();
  const matches = names.filter((n) => n.toLowerCase().includes(q.toLowerCase()));
  // A case can start using a parameter it never had; its value is then set on the Parameters tab. A custom step's
  // inputs are defined in their own section, so they are never created here.
  const canCreate = kind === 'data' && PARAMETER_NAME.test(q) && !names.includes(q);
  const options = [
    ...matches.map((name) => ({ name, create: false })),
    ...(canCreate ? [{ name: q, create: true }] : []),
  ];
  const current = Math.min(active, Math.max(options.length - 1, 0));

  const reset = () => {
    setOpen(false);
    setQuery('');
    setActive(0);
  };
  const close = () => {
    reset();
    trigger.current?.focus();
  };
  const pick = (name: string) => {
    reset();
    // Focus goes back to the button first; the field moves it on if the button is replaced (value became a chip).
    trigger.current?.focus();
    onPick(name);
  };

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) reset();
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  // The list opens under the field; bring all of it into view when the field is near the bottom of the popup, so it
  // is never cut off by the footer. (On phones it is a bottom sheet and already in view.)
  useLayoutEffect(() => {
    if (open) panel.current?.scrollIntoView?.({ block: 'nearest' });
  }, [open]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Close only the list, not the popup it sits in.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (options.length === 0) return;
      const by = e.key === 'ArrowDown' ? 1 : -1;
      setActive((current + by + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = options[current];
      if (o) pick(o.name);
    } else if (e.key === 'Tab') reset();
  };

  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-option-${i}`;
  let empty = '';
  if (options.length === 0) {
    if (q === '') {
      empty =
        kind === 'input'
          ? 'This custom step has no inputs yet. Add one under Inputs.'
          : 'No parameters yet. Type a name to create one.';
    } else if (kind === 'data' && !PARAMETER_NAME.test(q)) {
      empty = 'A name starts with a letter and uses only letters, digits, - or _.';
    } else {
      empty = `No ${noun} matches “${q}”.`;
    }
  }

  return (
    <div ref={wrap} className={styles.picker}>
      <Button
        ref={trigger}
        size="sm"
        variant="ghost"
        icon="sliders"
        className={styles.trigger}
        data-picker
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {text ?? `Use ${noun}`}
      </Button>
      {open && (
        <>
          <div className={styles.backdrop} aria-hidden="true" onMouseDown={reset} />
          <div
            ref={panel}
            role="dialog"
            aria-label={`Choose ${kind === 'input' ? 'an input' : 'a parameter'}`}
            className={styles.panel}
            onKeyDown={onKey}
          >
            <div className={styles.panelHead}>
              <strong>{kind === 'input' ? 'Use an input' : 'Use a parameter'}</strong>
              <IconButton icon="close" label="Close" onClick={close} />
            </div>
            <TextInput
              ref={search}
              role="combobox"
              aria-label={kind === 'input' ? 'Search inputs' : 'Search or name a new parameter'}
              aria-autocomplete="list"
              aria-expanded={options.length > 0}
              aria-controls={options.length > 0 ? listId : undefined}
              aria-activedescendant={options.length > 0 ? optionId(current) : undefined}
              placeholder={kind === 'input' ? 'Search inputs' : 'Search or type a new name'}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
            />
            {options.length > 0 ? (
              <ul
                id={listId}
                role="listbox"
                aria-label={kind === 'input' ? 'Inputs' : 'Parameters'}
                className={styles.options}
              >
                {options.map((o, i) => (
                  <li
                    key={`${o.create ? 'new' : 'has'}-${o.name}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === current}
                    className={styles.option}
                    // Keep focus in the search box while the mouse picks.
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(o.name)}
                  >
                    {o.create ? (
                      <span className={styles.create}>
                        <Icon name="plus" size={14} /> Create parameter “{o.name}”
                      </span>
                    ) : (
                      <>
                        <span className={styles.optionName}>{o.name}</span>
                        {kind === 'data' && values !== undefined && (
                          <span className="visually-hidden">: </span>
                        )}
                        {kind === 'data' && values !== undefined && (
                          <span
                            className={
                              values[o.name]
                                ? styles.optionValue
                                : `${styles.optionValue} ${styles.noValue}`
                            }
                          >
                            {values[o.name] || 'no value yet'}
                          </span>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.empty} role="status">
                {empty}
              </p>
            )}
            <p className={styles.footnote}>
              {kind === 'input'
                ? 'A test case fills the inputs in when it uses this step.'
                : 'Values are set on the Parameters tab, for this case or the whole project.'}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/** What a step row passes to a field that may hold parameters. */
export interface TextFieldProps {
  /** Accessible name of the text box, such as "Step 1: Role". */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  /** Picking a parameter replaces the whole value instead of inserting it (a number in a custom step). */
  replace?: boolean;
}

/** A step's text field that can hold parameters, shown as chips instead of `{{…}}`. */
export function ValueField({
  label,
  value,
  onChange,
  placeholder,
  replace = false,
  kind,
  names,
  values,
}: TextFieldProps & ParameterSource) {
  const input = useRef<HTMLInputElement>(null);
  const group = useRef<HTMLDivElement>(null);
  /** Where focus goes after the next change: back into the text box (with the caret), or to "Change parameter". */
  const focusNext = useRef<{ to: 'input'; caret?: number | undefined } | { to: 'chip' } | null>(
    null,
  );
  const token = singleToken(value);
  const source = { kind, names, values };
  const noun = kind === 'input' ? 'input' : 'parameter';

  useEffect(() => {
    const next = focusNext.current;
    if (!next) return;
    focusNext.current = null;
    if (next.to === 'chip') {
      group.current?.querySelector<HTMLButtonElement>('button[data-picker]')?.focus();
    } else if (input.current) {
      input.current.focus();
      if (next.caret !== undefined) input.current.setSelectionRange(next.caret, next.caret);
    }
  });

  const insert = (name: string) => {
    const t = tokenOf(kind, name);
    let next = t;
    let caret: number | undefined;
    if (!replace && !token) {
      // At the cursor (or over the selection); an untouched box has its cursor at the end, as before.
      const start = input.current?.selectionStart ?? value.length;
      const end = input.current?.selectionEnd ?? start;
      next = `${value.slice(0, start)}${t}${value.slice(end)}`;
      caret = start + t.length;
    }
    focusNext.current = singleToken(next) ? { to: 'chip' } : { to: 'input', caret };
    onChange(next);
  };

  // The box takes the field's full width; the parameter action sits under it, so typing never loses room to it.
  if (token) {
    return (
      <div ref={group} className={styles.valueField} role="group" aria-label={label}>
        <div className={styles.chipField}>
          <span className={styles.chipSlot}>
            <ParameterChip kind={token.kind} name={token.name} values={values} />
          </span>
          <IconButton
            icon="close"
            label={`Type a value in ${label} instead`}
            className={styles.clear}
            onClick={() => {
              focusNext.current = { to: 'input' };
              onChange('');
            }}
          />
        </div>
        <ParameterPicker
          {...source}
          label={`Change ${noun} in ${label}`}
          text={`Change ${noun}`}
          onPick={insert}
        />
      </div>
    );
  }

  const mixed = splitTokens(value).some((p) => typeof p !== 'string');
  return (
    <span className={styles.valueField}>
      <TextInput
        ref={input}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {mixed && (
        <span className={styles.preview}>
          <span className={styles.previewLabel}>Reads as:</span>{' '}
          <TokenText text={value} values={values} />
        </span>
      )}
      <ParameterPicker {...source} label={`Use ${noun} in ${label}`} onPick={insert} />
    </span>
  );
}
