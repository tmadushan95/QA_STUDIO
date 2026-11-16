/**
 * Menu molecule: a "⋯" button (or a small text button, with `triggerLabel`) that opens a short list of actions, such as
 * the actions of a table row or a group of bulk actions.
 * Opens with click, Enter or Space; arrow keys move; Escape or a click outside closes and returns focus.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, IconButton } from '../atoms/Button.js';
import { Icon, type IconName } from '../atoms/Icon.js';
import styles from './Menu.module.css';

/** One entry of a `Menu`. */
export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  /** Shown in red, for deleting and other actions that cannot be undone. */
  danger?: boolean;
  disabled?: boolean;
}

/** Props of `Menu`. */
export interface MenuProps {
  /** Accessible name of the button, for example "Actions for TC_08". */
  label: string;
  items: MenuItem[];
  /** Show a small text button ("Write steps ▾") instead of the "⋯" icon; `label` stays its accessible name. */
  triggerLabel?: string;
}

/** The visible top and bottom of the nearest ancestor that scrolls or clips, or of the window when none does. */
function clippingBounds(el: HTMLElement): { top: number; bottom: number } {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (getComputedStyle(p).overflowY !== 'visible') {
      const r = p.getBoundingClientRect();
      return { top: Math.max(r.top, 0), bottom: Math.min(r.bottom, window.innerHeight) };
    }
  }
  return { top: 0, bottom: window.innerHeight };
}

/** A "more actions" drop-down menu. */
export function Menu({ label, items, triggerLabel }: MenuProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  // Before the first paint (and before focus could scroll it into view), open upwards when the list would run past the
  // bottom of whatever clips it, such as the last rows of a table that scrolls inside itself, and there is room above.
  useLayoutEffect(() => {
    const el = list.current;
    const trigger = button.current;
    if (!open || !el || !trigger) return;
    const rect = el.getBoundingClientRect();
    const bounds = clippingBounds(el);
    const anchor = trigger.getBoundingClientRect();
    if (rect.bottom <= bounds.bottom) return;
    if (anchor.top - bounds.top > rect.height) {
      el.dataset.placement = 'up';
      return;
    }
    // Fits neither way inside the clipping box (a short table that scrolls inside itself), so the list would be cut
    // off and spill over the cells beside it. Float it over the page instead, right-aligned under the trigger.
    el.dataset.placement = 'float';
    // Where top/left 0 now lands: the window, unless an ancestor with a transform or filter anchors fixed boxes.
    const origin = el.getBoundingClientRect();
    const gap = rect.top - anchor.bottom;
    const fitsBelow = anchor.bottom + gap + origin.height <= window.innerHeight;
    const top = fitsBelow ? anchor.bottom + gap : Math.max(anchor.top - gap - origin.height, 0);
    el.style.top = `${top - origin.top}px`;
    el.style.left = `${Math.max(anchor.right - origin.width, 0) - origin.left}px`;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const away = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && e.target !== button.current) setOpen(false);
    };
    // A floating list is pinned to the window, so it would drift away from its row once anything scrolls.
    const floating = list.current?.dataset.placement === 'float';
    const dismiss = () => setOpen(false);
    document.addEventListener('mousedown', away);
    if (floating) {
      window.addEventListener('scroll', dismiss, true);
      window.addEventListener('resize', dismiss);
    }
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    const all = [
      ...(list.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
    ];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? (i + 1) % all.length : (i - 1 + all.length) % all.length;
      all[next]?.focus();
    } else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div className={styles.wrap}>
      {triggerLabel ? (
        <Button
          ref={button}
          size="sm"
          aria-label={label === triggerLabel ? undefined : label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          {triggerLabel}
          <Icon name="down" size={14} />
        </Button>
      ) : (
        <IconButton
          ref={button}
          icon="more"
          label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen((o) => !o)}
        />
      )}
      {open && (
        <ul
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          className={styles.menu}
          onKeyDown={onKey}
        >
          {items.map((it) => (
            <li key={it.label} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={it.disabled}
                className={it.danger ? `${styles.item} ${styles.danger}` : styles.item}
                onClick={() => {
                  close();
                  it.onSelect();
                }}
              >
                {it.icon && <Icon name={it.icon} size={16} />}
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
