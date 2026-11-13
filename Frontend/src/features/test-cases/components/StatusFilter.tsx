/**
 * StatusFilter: one row of counted filter chips (All, No steps, …) at the top of the test case pages. It scrolls
 * sideways on phones, instead of a block of large cards plus separate tabs.
 */
import styles from './StatusFilter.module.css';

/** One chip of the status filter. */
export interface StatusChip {
  id: string;
  label: string;
  count: number;
  /** A colour token for the dot, such as var(--color-success). */
  color?: string;
}

/** Counted filter chips in one row; exactly one is active. */
export function StatusFilter({
  chips,
  active,
  onChange,
  label,
}: {
  chips: StatusChip[];
  active: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <div className={styles.chips} role="radiogroup" aria-label={label}>
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={c.id === active}
          className={c.id === active ? `${styles.chip} ${styles.chipOn}` : styles.chip}
          onClick={() => onChange(c.id)}
        >
          {c.color && (
            <span className={styles.dot} style={{ background: c.color }} aria-hidden="true" />
          )}
          {c.label}
          <span className={styles.count}>{c.count}</span>
        </button>
      ))}
    </div>
  );
}
