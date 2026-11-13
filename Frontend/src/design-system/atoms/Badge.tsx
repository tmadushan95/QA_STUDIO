/**
 * Badge atom: a short label with a tone. Status is never colour alone: pass a `glyph` (✓ ✕ ⚠ …) and a word,
 * as the `StatusBadge` molecule does.
 */
import type { ReactNode } from 'react';
import styles from './Badge.module.css';

/** The colour meanings a badge can have. */
export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

/** Props of `Badge`. */
export interface BadgeProps {
  tone?: BadgeTone;
  glyph?: string;
  children: ReactNode;
}

/** A small status label. */
export function Badge({ tone = 'neutral', glyph, children }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`}>
      {glyph && (
        <span className={styles.glyph} aria-hidden="true">
          {glyph}
        </span>
      )}
      {children}
    </span>
  );
}
