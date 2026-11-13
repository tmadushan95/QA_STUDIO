import type { TestCase } from '@qa-studio/shared';
import type { RejectedRow, RowWarning, WorkbookResult } from './parse.js';
import { ImportError } from './upload.js';

export type ScopeMode = 'single-worksheet' | 'multiple-worksheets' | 'entire-workbook';

export interface Scope {
  workbook: string;
  mode: ScopeMode;
  worksheets: string[];
  cases: TestCase[];
  /** Rows rejected on the selected sheets, including cross-sheet duplicate IDs. */
  rejected: RejectedRow[];
  warnings: RowWarning[];
}

const eligible = (wb: WorkbookResult) => wb.sheets.filter((s) => s.detectedCount > 0);

/** The first worksheet that contains at least one valid test case, or [] when none does. */
export function defaultSelection(wb: WorkbookResult): string[] {
  const first = eligible(wb)[0];
  return first ? [first.name] : [];
}

/**
 * Resolve a worksheet selection into the cases to import or execute.
 * `undefined` or an empty list means the default (first eligible worksheet); `'all'` means every eligible one.
 * A test case ID that repeats across selected worksheets keeps its first occurrence; later ones are rejected.
 */
export function buildScope(wb: WorkbookResult, selection?: string[] | 'all'): Scope {
  const all = eligible(wb);
  const names =
    selection === 'all'
      ? all.map((s) => s.name)
      : selection && selection.length > 0
        ? selection
        : defaultSelection(wb);

  const chosen = names.map((n) => {
    const sheet = wb.sheets.find((s) => s.name === n);
    if (!sheet)
      throw new ImportError(
        'unknown-worksheet',
        `Worksheet "${n}" does not exist in ${wb.fileName}.`,
      );
    return sheet;
  });

  const seen = new Map<string, string>();
  const cases: TestCase[] = [];
  const rejected: RejectedRow[] = [];
  const warnings: RowWarning[] = [];
  for (const sheet of chosen) {
    rejected.push(...sheet.rejected);
    warnings.push(...sheet.warnings);
    for (const tc of sheet.cases) {
      const firstSheet = seen.get(tc.id);
      if (firstSheet !== undefined) {
        rejected.push({
          worksheet: sheet.name,
          rowNumber: tc.source.rowNumber,
          id: tc.id,
          reasons: [
            `Duplicate test case ID "${tc.id}" already imported from worksheet "${firstSheet}"`,
          ],
          raw: [],
        });
        continue;
      }
      seen.set(tc.id, sheet.name);
      cases.push(tc);
    }
  }

  const mode: ScopeMode =
    selection === 'all' || (names.length === all.length && names.length > 1)
      ? 'entire-workbook'
      : names.length === 1
        ? 'single-worksheet'
        : 'multiple-worksheets';
  return { workbook: wb.fileName, mode, worksheets: names, cases, rejected, warnings };
}

/** Narrow a scope to individually selected test case IDs; IDs outside the scope are reported, not ignored. */
export function selectCases(scope: Scope, ids: string[]): { scope: Scope; missing: string[] } {
  const wanted = new Set(ids);
  const cases = scope.cases.filter((c) => wanted.has(c.id));
  const found = new Set(cases.map((c) => c.id));
  return { scope: { ...scope, cases }, missing: ids.filter((i) => !found.has(i)) };
}
