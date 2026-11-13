/**
 * Requests of the Import feature: upload a workbook, map its columns, preview and import, then convert the imported
 * cases into steps as a background job whose progress is followed live.
 */
import type { TestCase } from '@qa-studio/shared';
import { get, send, upload } from '../../shared/api/http.js';

/** What was detected on one worksheet. */
export interface SheetSummary {
  name: string;
  status: 'valid' | 'has-errors' | 'empty' | 'unrecognized' | 'too-large';
  message?: string;
  headerRow?: number;
  columnCount: number;
  sample: string[][];
  mapping: Record<string, number>;
  autoHeaderRow?: number;
  autoMapping?: Record<string, number>;
  detectedCount: number;
  rejectedCount: number;
  warningCount: number;
}

/** An uploaded workbook, ready to be reviewed. */
export interface ImportSummary {
  id: string;
  fileName: string;
  defaultSelection: string[];
  sheets: SheetSummary[];
}

/** What importing added or replaced. */
export interface CommitResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
  rejected: number;
  caseIds: string[];
}

/** How converting one case into steps ended. */
export type ConversionItemStatus = 'pending' | 'ready' | 'needs-review' | 'failed' | 'skipped';

/** A background job turning imported cases into steps. */
export interface ConversionJob {
  id: string;
  status: 'running' | 'done' | 'cancelled';
  startedAt: string;
  endedAt?: string;
  total: number;
  counts: Record<ConversionItemStatus, number>;
  items: {
    caseId: string;
    title: string;
    status: ConversionItemStatus;
    steps: number;
    message?: string;
  }[];
}

/** Where the blank workbook template downloads from. */
export const templateUrl = '/api/template.xlsx';

const sheetQuery = (sheets: string[]) =>
  sheets.map((s) => `sheet=${encodeURIComponent(s)}`).join('&');

/** Where the rows that could not be imported download from. */
export const rejectedUrl = (id: string, sheets: string[]) =>
  `/api/imports/${id}/errors.xlsx?${sheetQuery(sheets)}`;

/** Upload a workbook. Nothing is imported yet. */
export const uploadWorkbook = (file: File) => upload<ImportSummary>('/api/imports', file);

/** Set by hand which column feeds which field of a worksheet. */
export const saveMapping = (
  id: string,
  sheet: string,
  headerRow: number,
  mapping: Record<string, number>,
) => send<ImportSummary>(`/api/imports/${id}/mapping`, { sheet, headerRow, mapping }, 'PUT');

/** The first cases the chosen worksheets would import. */
export const previewCases = (id: string, sheets: string[]) =>
  get<{ total: number; items: TestCase[]; rejectedCount?: number }>(
    `/api/imports/${id}/cases?${sheetQuery(sheets)}&pageSize=5`,
  );

/** Add the chosen worksheets to the inventory. */
/** Where new cases are filed: a suite and project version chosen on the Test Case Studio page. */
export interface FilingTarget {
  /** With no suite, each module becomes a suite of this project. */
  projectId?: number;
  testSuiteId?: number;
  projectVersionId?: number;
}

export const commitImport = (
  id: string,
  sheets: string[],
  replace: boolean,
  target: FilingTarget = {},
) => send<CommitResult>(`/api/imports/${id}/commit`, { sheets, replace, ...target });

/** Start turning these cases into steps with the rule-based converter. */
export const startConversion = (caseIds: string[]) =>
  send<ConversionJob>('/api/conversions', { caseIds });

/** Conversion jobs, running and finished. */
export async function fetchConversions(): Promise<ConversionJob[]> {
  const r = await get<{ items?: ConversionJob[] }>('/api/conversions');
  return Array.isArray(r?.items) ? r.items : [];
}

/** Stop a conversion job. */
export const cancelConversion = (id: string) =>
  send<ConversionJob>(`/api/conversions/${id}/cancel`);

/** Ask AI to finish the steps the converter could not. */
export const startAiDrafts = (caseIds: string[]) =>
  send<{ id: string }>('/api/ai/generate', { caseIds });
