/**
 * Dialog organism: the one popup used across the app.
 *
 * - Sizes: `sm` (confirmations), `md` (short forms), `lg` (editors, wizards); full screen on phones.
 * - Sticky header and footer; only the body scrolls.
 * - Focus moves into the dialog, stays inside it, and returns to the opener when it closes.
 * - Escape, the ✕ button and the backdrop close it, and so does a footer button marked `data-dialog-close`. With
 *   unsaved changes (`dirty`) closing asks first; that question is the only dialog ever shown on top of another.
 * - Ctrl/Cmd+S calls `onSave` when given.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from '../atoms/Button.js';
import styles from './Dialog.module.css';

/** Props of `Dialog`. */
export interface DialogProps {
  title: ReactNode;
  /** Short context under the title, such as a status or "saved 2 min ago". */
  subtitle?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  onClose: () => void;
  /** Content of the sticky footer, usually the buttons. A button with `data-dialog-close` closes like ✕ does. */
  footer?: ReactNode;
  /** True while there are unsaved changes: closing then asks "Discard changes?". */
  dirty?: boolean;
  /** Called on Ctrl/Cmd+S. */
  onSave?: () => void;
  /** Extra buttons in the header, left of ✕ (for example "full screen"). */
  headerActions?: ReactNode;
  /** Let the dialog fill the window (the user chose "full screen"). */
  expanded?: boolean;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A modal popup: traps focus, closes on Escape and asks before discarding unsaved changes. */
export function Dialog({
  title,
  subtitle,
  size = 'md',
  onClose,
  footer,
  dirty = false,
  onSave,
  headerActions,
  expanded = false,
  children,
}: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [askDiscard, setAskDiscard] = useState(false);
  // Read the latest props inside the long-lived key handler without re-binding it.
  const latest = useRef({ dirty, onClose, onSave, askDiscard });
  latest.current = { dirty, onClose, onSave, askDiscard };

  const requestClose = () => {
    if (latest.current.dirty) setAskDiscard(true);
    else latest.current.onClose();
  };

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first =
      panel.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (latest.current.askDiscard) return; // the confirmation handles its own keys
      if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && latest.current.onSave) {
        e.preventDefault();
        latest.current.onSave();
      } else if (e.key === 'Tab' && panel.current) {
        // Keep focus inside the dialog.
        const all = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (all.length === 0) return;
        const firstEl = all[0]!;
        const lastEl = all[all.length - 1]!;
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // requestClose only reads `latest`, so binding once is correct.
  }, []);

  return createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={(e) => e.target === e.currentTarget && requestClose()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={[styles.panel, styles[size], expanded && styles.expanded]
          .filter(Boolean)
          .join(' ')}
      >
        <div className={styles.header}>
          <div className={styles.titles}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
          </div>
          <div className={styles.headerActions}>
            {headerActions}
            <IconButton icon="close" label="Close" onClick={requestClose} />
          </div>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && (
          // A footer "Close" goes through the same path as ✕, so unsaved changes are never dropped without asking.
          <div
            className={styles.footer}
            onClick={(e) => {
              const el = (e.target as Element).closest('[data-dialog-close]');
              if (el && !(el as HTMLButtonElement).disabled) requestClose();
            }}
          >
            {footer}
          </div>
        )}
      </div>
      {askDiscard && (
        <ConfirmDialog
          title="Discard changes?"
          confirmLabel="Discard"
          danger
          onConfirm={() => {
            setAskDiscard(false);
            latest.current.onClose();
          }}
          onCancel={() => setAskDiscard(false)}
        >
          Your changes have not been saved.
        </ConfirmDialog>
      )}
    </div>,
    document.body,
  );
}

/** Props of `ConfirmDialog`. */
export interface ConfirmDialogProps {
  title: ReactNode;
  children: ReactNode;
  confirmLabel: string;
  /** Red confirm button, for actions that remove data. */
  danger?: boolean;
  busy?: boolean;
  /**
   * The text the person must type to enable the confirm button, for actions with a wide effect (for example the
   * number of cases to delete).
   */
  typeToConfirm?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A small yes/no dialog. Keyboard: Escape cancels, Enter confirms when the button is enabled. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  busy = false,
  typeToConfirm,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const ok = !typeToConfirm || typed.trim() === typeToConfirm;
  return (
    <Dialog
      title={title}
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={!ok}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={styles.confirmText}>{children}</div>
      {typeToConfirm && (
        <label className={styles.typeToConfirm}>
          <span>
            Type <strong>{typeToConfirm}</strong> to confirm
          </span>
          <input
            data-autofocus
            // Wide-effect actions are confirmed by typing; voice may never type this for the user.
            data-voice-manual="true"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ok && onConfirm()}
          />
        </label>
      )}
    </Dialog>
  );
}
