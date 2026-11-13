import ExcelJS from 'exceljs';
import { SCHEMA_VERSION, TestCase } from '@qa-studio/shared';
import { autoMap, FIELDS, type ColumnMapping, type Field } from './columns.js';
import { DEFAULT_LIMITS, ImportError, validateUpload, type ImportLimits } from './upload.js';

export type SheetStatus = 'valid' | 'has-errors' | 'empty' | 'unrecognized' | 'too-large';

export interface RejectedRow {
  worksheet: string;
  rowNumber: number;
  id?: string | undefined;
  reasons: string[];
  /** Original cell text for the row, for the error workbook. */
  raw: string[];
}

export interface RowWarning {
  worksheet: string;
  rowNumber: number;
  id: string;
  message: string;
}

export interface SheetResult {
  name: string;
  status: SheetStatus;
  /** Why the sheet was not parsed (unrecognized / too-large). */
  message?: string | undefined;
  headerRow?: number | undefined;
  columnCount: number;
  /** First rows as text, so a UI can offer manual column mapping. */
  sample: string[][];
  headers: string[];
  mapping: ColumnMapping;
  /**
   * What header detection found on its own, kept even when a manual override is applied, so a UI can show which
   * fields were auto-detected and offer to go back to them.
   */
  autoHeaderRow?: number | undefined;
  autoMapping: ColumnMapping;
  /** Number of valid test cases found. */
  detectedCount: number;
  cases: TestCase[];
  rejected: RejectedRow[];
  warnings: RowWarning[];
}

export interface WorkbookResult {
  fileName: string;
  sheets: SheetResult[];
}

export interface MappingOverride {
  headerRow: number;
  mapping: ColumnMapping;
}

export interface ParseOptions {
  limits?: ImportLimits;
  /** Per-worksheet manual header row and column mapping. */
  overrides?: Record<string, MappingOverride>;
}

const HEADER_SCAN_ROWS = 10;
const SAMPLE_ROWS = 6;

export function cellText(v: ExcelJS.CellValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if ('richText' in v)
    return v.richText
      .map((r) => r.text)
      .join('')
      .trim();
  if ('formula' in v || 'sharedFormula' in v)
    return cellText((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
  if ('text' in v) return String(v.text).trim(); // hyperlink
  if ('error' in v) return '';
  return '';
}

function rowTexts(ws: ExcelJS.Worksheet, rowNumber: number, cols: number): string[] {
  const row = ws.getRow(rowNumber);
  return Array.from({ length: cols }, (_, i) => cellText(row.getCell(i + 1).value));
}

/** Split a steps cell into ordered steps, stripping "1.", "2)" or "Step 3:" prefixes. */
export function parseSteps(text: string): { order: number; action: string }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(step\s*)?\d+\s*[.):-]\s*/i, '').trim())
    .filter(Boolean)
    .map((action, i) => ({ order: i + 1, action }));
}

const list = (t: string): string[] =>
  t
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

function detectHeader(
  ws: ExcelJS.Worksheet,
  cols: number,
): { headerRow: number; mapping: ColumnMapping; headers: string[] } | undefined {
  let best:
    | { headerRow: number; mapping: ColumnMapping; headers: string[]; score: number }
    | undefined;
  const last = Math.min(HEADER_SCAN_ROWS, ws.rowCount);
  for (let r = 1; r <= last; r++) {
    const headers = rowTexts(ws, r, cols);
    const mapping = autoMap(headers);
    if (mapping.id === undefined || mapping.title === undefined) continue;
    const score = Object.keys(mapping).length;
    if (!best || score > best.score) best = { headerRow: r, mapping, headers, score };
  }
  return best;
}

function parseSheet(
  ws: ExcelJS.Worksheet,
  fileName: string,
  limits: ImportLimits,
  override: MappingOverride | undefined,
): SheetResult {
  const base: SheetResult = {
    name: ws.name,
    status: 'empty',
    columnCount: 0,
    sample: [],
    headers: [],
    mapping: {},
    autoMapping: {},
    detectedCount: 0,
    cases: [],
    rejected: [],
    warnings: [],
  };
  if (ws.rowCount > limits.maxRows || ws.columnCount > limits.maxCols) {
    return {
      ...base,
      status: 'too-large',
      message: `Worksheet exceeds limits (${limits.maxRows} rows, ${limits.maxCols} columns).`,
    };
  }
  if (ws.rowCount === 0) return base;

  const cols = Math.max(ws.columnCount, 1);
  base.columnCount = cols;
  for (let r = 1; r <= Math.min(SAMPLE_ROWS, ws.rowCount); r++)
    base.sample.push(rowTexts(ws, r, cols));
  const detected = detectHeader(ws, cols);
  base.autoHeaderRow = detected?.headerRow;
  base.autoMapping = detected?.mapping ?? {};
  const found = override
    ? {
        headerRow: override.headerRow,
        mapping: override.mapping,
        headers: rowTexts(ws, override.headerRow, cols),
      }
    : detected;
  if (!found || found.mapping.id === undefined || found.mapping.title === undefined) {
    return {
      ...base,
      status: 'unrecognized',
      message:
        'No header row with both a test case ID and a title column was found. Map the columns manually.',
    };
  }
  const { headerRow, mapping, headers } = found;
  const seen = new Map<string, number>();
  const get = (raw: string[], f: Field): string => {
    const col = mapping[f];
    return col === undefined ? '' : (raw[col - 1] ?? '');
  };

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const raw = rowTexts(ws, r, cols);
    if (raw.every((c) => c === '')) continue;
    const id = get(raw, 'id');
    const reasons: string[] = [];
    if (!id) reasons.push('Missing test case ID');
    if (!get(raw, 'title')) reasons.push('Missing title');
    if (id && seen.has(id))
      reasons.push(`Duplicate test case ID "${id}" (first seen at row ${seen.get(id)})`);

    const parsed = TestCase.safeParse({
      schemaVersion: SCHEMA_VERSION,
      id,
      title: get(raw, 'title'),
      description: get(raw, 'description') || undefined,
      module: get(raw, 'module') || undefined,
      preconditions: get(raw, 'preconditions') || undefined,
      steps: parseSteps(get(raw, 'steps')),
      expectedResult: get(raw, 'expectedResult') || undefined,
      priority: get(raw, 'priority') || undefined,
      severity: get(raw, 'severity') || undefined,
      testType: get(raw, 'testType') || undefined,
      userRole: get(raw, 'userRole') || undefined,
      tags: list(get(raw, 'tags')),
      dependsOn: list(get(raw, 'dependsOn')),
      source: { workbook: fileName, worksheet: ws.name, rowNumber: r },
    });
    if (!parsed.success && reasons.length === 0) {
      reasons.push(...parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    }
    if (reasons.length > 0 || !parsed.success) {
      base.rejected.push({ worksheet: ws.name, rowNumber: r, id: id || undefined, reasons, raw });
      continue;
    }
    seen.set(id, r);
    // Strip undefined keys so exactOptionalPropertyTypes-style consumers see absent fields.
    base.cases.push(parsed.data);
    if (!parsed.data.expectedResult && !parsed.data.steps.some((s) => s.expected)) {
      base.warnings.push({
        worksheet: ws.name,
        rowNumber: r,
        id,
        message: 'No expected result provided; none will be assumed.',
      });
    }
  }

  const detectedCount = base.cases.length;
  const status: SheetStatus =
    detectedCount === 0 && base.rejected.length === 0
      ? 'empty'
      : base.rejected.length > 0
        ? 'has-errors'
        : 'valid';
  return { ...base, status, headerRow, headers, mapping, detectedCount };
}

/** Validate and parse an uploaded workbook. Never discards rows silently: bad rows land in `rejected`. */
export async function parseWorkbook(
  file: { name: string; bytes: Uint8Array },
  options: ParseOptions = {},
): Promise<WorkbookResult> {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const fileName = validateUpload(file, limits);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(file.bytes) as unknown as ExcelJS.Buffer);
  } catch {
    throw new ImportError(
      'corrupt-workbook',
      'The workbook could not be read. It may be corrupt or password-protected.',
    );
  }
  if (wb.worksheets.length > limits.maxSheets) {
    throw new ImportError(
      'too-many-sheets',
      `Workbook has ${wb.worksheets.length} worksheets; the limit is ${limits.maxSheets}.`,
    );
  }
  const sheets = wb.worksheets.map((ws) =>
    parseSheet(ws, fileName, limits, options.overrides?.[ws.name]),
  );
  return { fileName, sheets };
}

export { FIELDS };
