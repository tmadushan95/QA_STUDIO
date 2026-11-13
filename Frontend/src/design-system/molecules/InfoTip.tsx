/**
 * InfoTip molecule: a small ⓘ button that shows details in a popover — on hover, on keyboard focus, or pinned by a
 * click (for touch screens and for reading long messages). Escape or a click elsewhere closes it.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../atoms/Icon.js';
import styles from './InfoTip.module.css';

/** Props of `InfoTip`. */
export interface InfoTipProps {
  /** Accessible name of the button, for example "Show issue for TC_08". */
  label: string;
  /** Colour of the icon: danger for failures, warning for blocked. */
  tone?: 'danger' | 'warning' | 'info';
  children: ReactNode;
}

/** A small "i" that explains something on hover or focus. */
export function InfoTip({ label, tone = 'info', children }: InfoTipProps) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const id = useId();
  const open = hover || pinned;

  useEffect(() => {
    if (!pinned) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setPinned(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (setPinned(false), setHover(false));
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [pinned]);

  return (
    <span
      ref={wrap}
      className={styles.wrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        className={`${styles.button} ${styles[tone]}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setPinned((p) => !p)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
      >
        <Icon name="info" size={16} />
      </button>
      {open && (
        <span id={id} role="tooltip" className={styles.popover}>
          {children}
        </span>
      )}
    </span>
  );
}
