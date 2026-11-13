/**
 * FieldMapping: maps worksheet columns to test case fields, one row per field. Each row says whether its column
 * was auto-detected or chosen by hand, shows the first test case's value so a wrong column is obvious, and can go
 * back to the detected column on its own.
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Select,
  StatusBadge,
  TextInput,
} from '../../../design-system/index.js';
import type { SheetSummary } from '../api.js';
import styles from './Import.module.css';

/** Field key, label, required. Same order as the workbook template. */
export const FIELDS: [string, string, boolean][] = [
  ['id', 'Test case ID', true],
  ['title', 'Title', true],
  ['description', 'Description', false],
  ['module', 'Module', false],
  ['preconditions', 'Preconditions', false],
  ['steps', 'Steps', false],
  ['expectedResult', 'Expected result', false],
  ['priority', 'Priority', false],
  ['severity', 'Severity', false],
  ['testType', 'Test type', false],
  ['userRole', 'User role', false],
  ['tags', 'Tags', false],
  ['dependsOn', 'Dependencies', false],
];

type FieldState = 'auto' | 'manual' | 'unmapped';

/**
 * Whether a field's column came from detection or a person. Detection only counts on the detected header row:
 * on another row the same column number means a different header.
 */
function stateOf(
  key: string,
  mapping: Record<string, number>,
  headerRow: number,
  sheet: SheetSummary,
): FieldState {
  const col = mapping[key];
  if (!col) return 'unmapped';
  return headerRow === sheet.autoHeaderRow && sheet.autoMapping?.[key] === col ? 'auto' : 'manual';
}

/** How a worksheet is mapped as a whole, for the worksheet list. */
export function sheetMappingState(sheet: SheetSummary): FieldState {
  const keys = Object.keys(sheet.mapping);
  if (keys.length === 0) return 'unmapped';
  const row = sheet.headerRow ?? 1;
  return keys.every((k) => stateOf(k, sheet.mapping, row, sheet) === 'auto') ? 'auto' : 'manual';
}

/** Props of `FieldMapping`. */
export interface FieldMappingProps {
  sheet: SheetSummary;
  onApply: (headerRow: number, mapping: Record<string, number>) => Promise<void>;
  onCancel: () => void;
}

/** One row per field: the detected column, an example value and how to change it. */
export function FieldMapping({ sheet, onApply, onCancel }: FieldMappingProps) {
  const [headerRow, setHeaderRow] = useState(sheet.headerRow ?? sheet.autoHeaderRow ?? 1);
  const [mapping, setMapping] = useState<Record<string, number>>(sheet.mapping);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const headers = sheet.sample[headerRow - 1] ?? [];
  // The row right under the header is the first test case: the best value to check a column against.
  const sample = sheet.sample[headerRow] ?? [];
  const columns = Array.from({ length: Math.max(sheet.columnCount, 1) }, (_, i) => i + 1);
  const auto = sheet.autoMapping ?? {};
  const detected = sheet.autoHeaderRow !== undefined && Object.keys(auto).length > 0;
  const states = FIELDS.map(([k]) => stateOf(k, mapping, headerRow, sheet));
  const count = (s: FieldState) => states.filter((x) => x === s).length;
  const usedBy = new Map<number, string[]>();
  for (const [k, label] of FIELDS) {
    const c = mapping[k];
    if (c) usedBy.set(c, [...(usedBy.get(c) ?? []), label]);
  }

  const setField = (k: string, col: number | undefined) => {
    const next = { ...mapping };
    if (col) next[k] = col;
    else delete next[k];
    setMapping(next);
  };

  const apply = async () => {
    const missing = FIELDS.filter(([k, , req]) => req && !mapping[k]).map(([, l]) => l);
    if (missing.length) {
      setError(`Map the required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`);
      return;
    }
    setError('');
    setBusy(true);
    try {
      await onApply(headerRow, mapping);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.mapping} aria-label={`Map fields for ${sheet.name}`}>
      <div className={styles.mappingHead}>
        <div>
          <h3>Map fields for “{sheet.name}”</h3>
          <p className={styles.muted}>
            {detected
              ? 'Columns were detected from the header names. Check each row and change any that are wrong.'
              : 'Columns could not be detected. Choose a worksheet column for each field.'}
          </p>
        </div>
        <div className={styles.tally} aria-label="Mapping summary">
          <Badge tone="success" glyph="✓">
            {count('auto')} auto-detected
          </Badge>
          <Badge tone="primary" glyph="✎">
            {count('manual')} by hand
          </Badge>
          <Badge tone="warning" glyph="!">
            {count('unmapped')} not mapped
          </Badge>
        </div>
      </div>
      <div className={styles.toolbar}>
        <label className={styles.inlineLabel}>
          Header row
          <TextInput
            type="number"
            min={1}
            className={styles.narrow}
            value={headerRow}
            onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        {detected && (
          <Button
            size="sm"
            onClick={() => {
              setHeaderRow(sheet.autoHeaderRow ?? 1);
              setMapping({ ...auto });
            }}
          >
            Use all detected columns
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setMapping({})}>
          Clear all
        </Button>
      </div>
      <ul className={styles.fieldList}>
        {FIELDS.map(([k, label, required], i) => {
          const col = mapping[k];
          const state = states[i]!;
          const clash = col ? (usedBy.get(col) ?? []).filter((l) => l !== label) : [];
          const canRestore =
            headerRow === sheet.autoHeaderRow && auto[k] !== undefined && state !== 'auto';
          return (
            <li
              key={k}
              className={
                required && !col ? `${styles.fieldRow} ${styles.missing}` : styles.fieldRow
              }
            >
              <span className={styles.fieldName}>
                {label}
                {required && <span className={styles.req}>Required</span>}
              </span>
              <span>
                <Select
                  aria-label={`${label} column`}
                  value={col ?? ''}
                  onChange={(e) => setField(k, Number(e.target.value) || undefined)}
                >
                  <option value="">Not mapped</option>
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      Column {c}
                      {headers[c - 1] ? `: ${headers[c - 1]}` : ''}
                    </option>
                  ))}
                </Select>
                {clash.length > 0 && (
                  <span className={styles.clash}>Also used for {clash.join(', ')}.</span>
                )}
              </span>
              <span className={styles.sample} title={col ? sample[col - 1] : undefined}>
                {col && sample[col - 1] ? sample[col - 1] : <span className={styles.muted}>—</span>}
              </span>
              <span className={styles.source}>
                <StatusBadge status={state} />
                {canRestore && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Use detected column for ${label}`}
                    onClick={() => setField(k, auto[k])}
                  >
                    Use detected
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className={styles.toolbar}>
        <Button variant="primary" onClick={() => void apply()} loading={busy}>
          Apply mapping
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </section>
  );
}
