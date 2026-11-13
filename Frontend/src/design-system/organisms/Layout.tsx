/**
 * Layout organisms used by every page: `PageHeader` (title, description, main actions), `Panel` (a titled card
 * for one group of content) and `SaveBar` (sticky save/discard bar that appears with unsaved changes).
 */
import type { ReactNode } from 'react';
import { Button } from '../atoms/Button.js';
import styles from './Layout.module.css';

/** Props of `PageHeader`. */
export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Main page actions; the first should be the primary one. */
  actions?: ReactNode;
}

/** A page title with its description and main actions. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <h1>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

/** Props of `Panel`. */
export interface PanelProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** No inner padding, for a table or list that runs edge to edge. */
  flush?: boolean;
}

/** A titled card grouping related content. */
export function Panel({ title, description, actions, children, flush }: PanelProps) {
  return (
    <section className={styles.panel}>
      {(title || actions) && (
        <div className={styles.panelHeader}>
          <div>
            {title && <h2 className={styles.panelTitle}>{title}</h2>}
            {description && <p className={styles.description}>{description}</p>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      )}
      <div className={flush ? undefined : styles.panelBody}>{children}</div>
    </section>
  );
}

/** Props of `SaveBar`. */
export interface SaveBarProps {
  /** Number of unsaved changes, or true when the count is unknown. 0/false hides the bar's message. */
  dirty: number | boolean;
  saving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saveLabel?: string;
}

/** The bar that appears when a form has unsaved changes. */
export function SaveBar({
  dirty,
  saving = false,
  onSave,
  onDiscard,
  saveLabel = 'Save changes',
}: SaveBarProps) {
  if (!dirty) return null;
  return (
    <div className={styles.saveBar} role="region" aria-label="Unsaved changes">
      <span className={styles.unsaved}>
        {typeof dirty === 'number'
          ? `${dirty} unsaved change${dirty === 1 ? '' : 's'}`
          : 'Unsaved changes'}
      </span>
      <div className={styles.actions}>
        <Button onClick={onDiscard} disabled={saving}>
          Discard
        </Button>
        <Button variant="primary" onClick={onSave} loading={saving}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
