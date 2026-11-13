/**
 * Small building blocks shared by the Test Case Studio and Test Execution lists: the case title, the "last result" cell
 * and the parameters cell. The scope bar and status chips live in ScopeBar.tsx.
 */
import { href } from '../../../shared/hooks/useRoute.js';
import { InfoTip, StatusBadge } from '../../../design-system/index.js';
import { formatDate } from '../../../shared/lib/format.js';
import type { CaseRow } from '../useCaseLibrary.js';
import styles from './CaseList.module.css';

/** Where a case is filed, as one muted line under its title. */
export function CaseTitle({ row }: { row: CaseRow }) {
  const tc = row.tc;
  const where = [
    tc.testSuiteName && `${tc.projectName} › ${tc.testSuiteName}`,
    tc.projectVersionName && `v${tc.projectVersionName}`,
    tc.priority && `${tc.priority} priority`,
  ].filter(Boolean);
  return (
    <span className={styles.title}>
      {tc.title}
      {where.length > 0 && <span className={styles.sub}>{where.join(' · ')}</span>}
    </span>
  );
}

/** Parameters cell: ✓ when every value is set, a warning with the count when some are missing, — when none needed. */
export function ParamsCell({ row }: { row: CaseRow }) {
  if (row.needed === 0) return <span className={styles.sub}>—</span>;
  if (row.missing.length === 0)
    return (
      <span className={styles.ok} title="Every parameter has a value">
        ✓
      </span>
    );
  return <StatusBadge status="needs-review" label={`${row.missing.length} missing`} />;
}

/** The newest result of a case, when it ran, and — for a failure or block — an ⓘ that shows the issue. */
export function LastResult({ row }: { row: CaseRow }) {
  const last = row.last;
  if (!last) return <span className={styles.sub}>Not run yet</span>;
  const r = last.result;
  const issue =
    r.failure && (r.status === 'failed' || r.status === 'blocked' || r.status === 'cancelled');
  return (
    <span className={styles.last}>
      <span className={styles.lastLine}>
        <StatusBadge status={r.status} />
        {issue && (
          <InfoTip
            label={`Show issue for ${row.tc.id}`}
            tone={r.status === 'failed' ? 'danger' : 'warning'}
          >
            <strong>
              {r.status === 'failed'
                ? 'Why it failed'
                : r.status === 'blocked'
                  ? 'Why it was blocked'
                  : 'Cancelled'}
            </strong>
            <span>{r.failure!.message}</span>
            {r.failure!.expected !== undefined && (
              <span className={styles.sub}>
                Expected: {r.failure!.expected} · Actual: {r.failure!.actual ?? '—'}
              </span>
            )}
            {r.account && <span className={styles.sub}>Run as {r.account}</span>}
            <a href={href('runs', last.runId)}>Open the run</a>
          </InfoTip>
        )}
      </span>
      <span className={styles.sub}>{formatDate(last.at)}</span>
    </span>
  );
}
