import path from 'node:path';

export type ImportErrorCode =
  | 'unsupported-format'
  | 'too-large'
  | 'empty-file'
  | 'not-a-workbook'
  | 'corrupt-workbook'
  | 'too-many-sheets'
  | 'unknown-worksheet';

export class ImportError extends Error {
  override name = 'ImportError';
  constructor(
    readonly code: ImportErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ImportLimits {
  maxBytes: number;
  maxSheets: number;
  maxRows: number;
  maxCols: number;
}

export const DEFAULT_LIMITS: ImportLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxSheets: 50,
  maxRows: 20_000,
  maxCols: 100,
};

/** Keep only a safe base name: no directories, no control characters. */
export function sanitizeFileName(name: string): string {
  const base = path.win32.basename(path.posix.basename(name.replace(/\\/g, '/')));
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim();
  return clean || 'workbook.xlsx';
}

/**
 * Validate an uploaded file before parsing. Returns the sanitized file name.
 * `.xls` (binary BIFF) is rejected explicitly: the parser reads OOXML only.
 */
export function validateUpload(
  file: { name: string; bytes: Uint8Array },
  limits: ImportLimits = DEFAULT_LIMITS,
): string {
  const name = sanitizeFileName(file.name);
  const ext = path.extname(name).toLowerCase();
  if (ext === '.xls') {
    throw new ImportError(
      'unsupported-format',
      'Legacy .xls files are not supported. Open the file in Excel and save it as .xlsx.',
    );
  }
  if (ext !== '.xlsx') {
    throw new ImportError(
      'unsupported-format',
      `Unsupported file type "${ext || name}". Upload an .xlsx file.`,
    );
  }
  if (file.bytes.length === 0) throw new ImportError('empty-file', 'The file is empty.');
  if (file.bytes.length > limits.maxBytes) {
    throw new ImportError(
      'too-large',
      `File is ${(file.bytes.length / 1048576).toFixed(1)} MB; the limit is ${limits.maxBytes / 1048576} MB.`,
    );
  }
  const b = file.bytes;
  // .xlsx is a ZIP archive: starts with "PK\x03\x04".
  if (!(b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04)) {
    throw new ImportError('not-a-workbook', 'The file content is not an .xlsx workbook.');
  }
  return name;
}
