/**
 * ImportDialog: the three-step Excel import, in one popup.
 *   1. Upload a workbook (or download the template).
 *   2. Choose worksheets and check their field mapping (auto-detected, or mapped by hand per field).
 *   3. Review and import. Importing starts converting the cases into steps in the background; the dialog closes and
 *      the Imports tab shows the progress live.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  Icon,
  Spinner,
  StatusBadge,
} from '../../../design-system/index.js';
import { errorMessage } from '../../../shared/api/http.js';
import { plural } from '../../../shared/lib/format.js';
import {
  commitImport,
  previewCases,
  rejectedUrl,
  saveMapping,
  startConversion,
  templateUrl,
  uploadWorkbook,
  type ConversionJob,
  type FilingTarget,
  type ImportSummary,
} from '../api.js';
import { FieldMapping, sheetMappingState } from './FieldMapping.js';
import styles from './Import.module.css';

const STEPS = ['Upload', 'Worksheets and fields', 'Review and import'];

const SHEET_STATUS: Record<string, string> = {
  valid: 'Ready',
  'has-errors': 'Some rows rejected',
  empty: 'No test cases',
  unrecognized: 'Columns not recognised',
  'too-large': 'Too large',
};

/** Props of `ImportDialog`. */
export interface ImportDialogProps {
  /** Test cases that exist already, so the person knows the import adds to them. */
  existing: number;
  onClose: () => void;
  /** Import done and conversion started. */
  onImported: (job: ConversionJob, imported: number) => void;
  /** Where new cases are filed. Without it, each module becomes a suite of the General project. */
  target?: FilingTarget;
}

/** The three-step import popup: upload, map fields, review. */
export function ImportDialog({ existing, onClose, onImported, target }: ImportDialogProps) {
  const [step, setStep] = useState(0);
  const [summary, setSummary] = useState<ImportSummary>();
  const [selected, setSelected] = useState<string[]>([]);
  const [mappingFor, setMappingFor] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [replace, setReplace] = useState(false);
  const [preview, setPreview] = useState<{ total: number; rejectedCount?: number }>();
  const fileInput = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const s = await uploadWorkbook(file);
      setSummary(s);
      setSelected(s.defaultSelection);
      setStep(1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (step !== 2 || !summary) return;
    setPreview(undefined);
    previewCases(summary.id, selected).then(setPreview, (e: unknown) => setError(errorMessage(e)));
  }, [step, summary, selected]);

  const eligible = summary?.sheets.filter((s) => s.detectedCount > 0) ?? [];
  const toggle = (name: string) => {
    const next = new Set(selected);
    if (!next.delete(name)) next.add(name);
    setSelected((summary?.sheets ?? []).map((s) => s.name).filter((n) => next.has(n)));
  };

  const applyMapping = async (
    sheet: string,
    headerRow: number,
    mapping: Record<string, number>,
  ) => {
    if (!summary) return;
    try {
      const next = await saveMapping(summary.id, sheet, headerRow, mapping);
      setSummary(next);
      const ok = next.sheets.find((s) => s.name === sheet)?.detectedCount;
      setSelected((sel) => [
        ...new Set([
          ...sel.filter((n) => next.sheets.find((s) => s.name === n)?.detectedCount),
          ...(ok ? [sheet] : []),
        ]),
      ]);
      setMappingFor(undefined);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const doImport = async () => {
    if (!summary) return;
    setBusy(true);
    setError('');
    try {
      const r = await commitImport(summary.id, selected, replace, target);
      const job = await startConversion(r.caseIds);
      onImported(job, r.caseIds.length);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const sheet = summary?.sheets.find((s) => s.name === mappingFor);

  return (
    <Dialog
      title="Import test cases from Excel"
      subtitle={summary ? summary.fileName : 'Upload a workbook to start'}
      size="lg"
      dirty={!!summary}
      onClose={onClose}
      footer={
        <>
          {step > 0 && (
            <Button onClick={() => setStep(step - 1)} disabled={busy} className={styles.backButton}>
              Back
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          {step === 1 && (
            <Button
              variant="primary"
              disabled={selected.length === 0 || !!mappingFor}
              onClick={() => setStep(2)}
            >
              Continue
            </Button>
          )}
          {step === 2 && (
            <Button
              variant="primary"
              icon="upload"
              loading={busy}
              disabled={!preview || preview.total === 0}
              onClick={() => void doImport()}
            >
              Import and convert {preview ? plural(preview.total, 'case') : ''}
            </Button>
          )}
        </>
      }
    >
      <ol className={styles.stepper} aria-label="Import steps">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={i < step ? styles.done : i === step ? styles.current : ''}
            aria-current={i === step ? 'step' : undefined}
          >
            <span className={styles.stepNo}>
              {i < step ? <Icon name="check" size={14} /> : i + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>

      {error && <Alert tone="danger">{error}</Alert>}

      {step === 0 && (
        <div
          className={styles.dropZone}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFile(e.dataTransfer.files[0]);
          }}
        >
          <span className={styles.dropIcon}>
            {busy ? <Spinner size={22} /> : <Icon name="upload" size={24} />}
          </span>
          <p className={styles.dropTitle}>
            {busy ? 'Reading the workbook…' : 'Drop an Excel workbook here'}
          </p>
          <p className={styles.muted}>.xlsx, up to 10 MB. Each worksheet can hold test cases.</p>
          <div className={styles.toolbar}>
            <Button variant="primary" onClick={() => fileInput.current?.click()} disabled={busy}>
              Choose file
            </Button>
            <a className={styles.link} href={templateUrl} download>
              Download the template
            </a>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx"
            aria-label="Excel workbook (.xlsx)"
            className="visually-hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {step === 1 &&
        summary &&
        (sheet ? (
          <FieldMapping
            key={sheet.name}
            sheet={sheet}
            onApply={(row, map) => applyMapping(sheet.name, row, map)}
            onCancel={() => setMappingFor(undefined)}
          />
        ) : (
          <div className={styles.stack}>
            <p className={styles.muted}>
              Choose the worksheets to import. Fields are detected from the header names; open “Map
              fields” to check or change them.
            </p>
            <ul className={styles.sheetList}>
              {summary.sheets.map((s) => {
                const mapState = sheetMappingState(s);
                return (
                  <li key={s.name} className={styles.sheetRow}>
                    <Checkbox
                      aria-label={`Select worksheet ${s.name}`}
                      checked={selected.includes(s.name)}
                      disabled={s.detectedCount === 0}
                      onChange={() => toggle(s.name)}
                    />
                    <div className={styles.sheetMain}>
                      <span className={styles.sheetName}>{s.name}</span>
                      <span className={styles.muted}>
                        {plural(s.detectedCount, 'test case')}
                        {s.rejectedCount > 0 && ` · ${plural(s.rejectedCount, 'rejected row')}`}
                        {s.message && ` · ${s.message}`}
                      </span>
                    </div>
                    <StatusBadge
                      status={
                        s.status === 'valid'
                          ? 'ready'
                          : s.status === 'has-errors'
                            ? 'needs-review'
                            : 'unmapped'
                      }
                      label={SHEET_STATUS[s.status] ?? s.status}
                    />
                    {s.status !== 'too-large' && (
                      <>
                        <StatusBadge status={mapState} />
                        <Button size="sm" onClick={() => setMappingFor(s.name)}>
                          Map fields
                        </Button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className={styles.toolbar}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected(eligible.map((s) => s.name))}
                disabled={eligible.length === 0}
              >
                Select all
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected([])}
                disabled={selected.length === 0}
              >
                Clear selection
              </Button>
            </div>
          </div>
        ))}

      {step === 2 && summary && (
        <div className={styles.stack}>
          {!preview ? (
            <p className={styles.muted}>
              <Spinner /> Counting test cases…
            </p>
          ) : (
            <div className={styles.reviewGrid}>
              <div className={styles.stat}>
                <span className={styles.statValue}>{preview.total}</span>
                <span className={styles.muted}>test cases to import</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statValue}>{selected.length}</span>
                <span className={styles.muted}>
                  {selected.length === 1 ? 'worksheet' : 'worksheets'}
                </span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statValue}>{preview.rejectedCount ?? 0}</span>
                <span className={styles.muted}>rejected rows</span>
                {(preview.rejectedCount ?? 0) > 0 && (
                  <a className={styles.link} href={rejectedUrl(summary.id, selected)} download>
                    Download them
                  </a>
                )}
              </div>
            </div>
          )}
          <Alert tone="info" title="What happens next">
            The cases are added, then each case’s written steps are converted into runnable steps in
            the background. You can follow the progress on the Imports tab and finish any case the
            converter could not.
          </Alert>
          {existing > 0 && (
            <Checkbox
              label={`Replace the ${plural(existing, 'existing test case')} instead of adding to them`}
              hint="Run history is kept. A case with the same ID is updated either way."
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
            />
          )}
        </div>
      )}
    </Dialog>
  );
}
