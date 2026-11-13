/**
 * Feedback molecules: `Alert` (an inline message with a tone), `EmptyState` (what to do when a list is empty),
 * `ProgressBar` (labelled progress) and `SearchBox` (a search input with its icon).
 */
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../atoms/Icon.js';
import styles from './Feedback.module.css';

/** Props of `Alert`. */
export interface AlertProps {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: ReactNode;
  children?: ReactNode;
  /** Buttons shown on the right, such as "Undo" or "Fill it". */
  actions?: ReactNode;
}

const ALERT_ICON: Record<NonNullable<AlertProps['tone']>, IconName> = {
  info: 'info',
  success: 'check',
  warning: 'alert',
  danger: 'alert',
};

/** An inline message about the state of the page. */
export function Alert({ tone = 'info', title, children, actions }: AlertProps) {
  return (
    <div
      className={`${styles.alert} ${styles[tone]}`}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <span className={styles.alertIcon}>
        <Icon name={ALERT_ICON[tone]} size={18} />
      </span>
      <div className={styles.alertBody}>
        {title && <p className={styles.alertTitle}>{title}</p>}
        {children && <div className={styles.alertText}>{children}</div>}
      </div>
      {actions && <div className={styles.alertActions}>{actions}</div>}
    </div>
  );
}

/** Props of `EmptyState`. */
export interface EmptyStateProps {
  icon?: IconName;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}

/** What a list or page shows when it has nothing to show. */
export function EmptyState({ icon = 'info', title, children, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>
        <Icon name={icon} size={24} />
      </span>
      <p className={styles.emptyTitle}>{title}</p>
      {children && <p className={styles.emptyText}>{children}</p>}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}

/** Props of `ProgressBar`. */
export interface ProgressBarProps {
  value: number;
  max: number;
  /** Accessible name, for example "Conversion progress". */
  label: string;
  tone?: 'primary' | 'success';
}

/** How far along a job is. */
export function ProgressBar({ value, max, label, tone = 'primary' }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      className={styles.progress}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <div className={`${styles.progressFill} ${styles[tone]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Props of `SearchBox`. */
export interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
}

/** A labelled search input. */
export function SearchBox({ value, onChange, label, placeholder }: SearchBoxProps) {
  return (
    <label className={styles.search}>
      <span className="visually-hidden">{label}</span>
      <Icon name="search" size={16} />
      <input
        type="search"
        value={value}
        placeholder={placeholder ?? label}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
