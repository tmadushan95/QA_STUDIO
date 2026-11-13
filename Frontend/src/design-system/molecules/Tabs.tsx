/**
 * Tabs molecule: an ARIA tab list. Arrow keys move between tabs, Home/End jump to the ends; only the active tab is
 * in the Tab order. The caller renders the panel and labels it with `tabPanelProps(active)`.
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import styles from './Tabs.module.css';

/** One tab of `Tabs`. */
export interface TabItem {
  id: string;
  label: ReactNode;
  /** A small count or marker after the label, such as "30" or "●". */
  badge?: ReactNode;
}

/** Props of `Tabs`. */
export interface TabsProps {
  /** Accessible name of the tab list. */
  label: string;
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  /** Unique prefix for element IDs when two tab lists share a page. */
  idPrefix?: string;
}

/** Props for the panel element that belongs to the active tab. */
export const tabPanelProps = (active: string, idPrefix = 'tab') => ({
  role: 'tabpanel' as const,
  id: `${idPrefix}-panel-${active}`,
  'aria-labelledby': `${idPrefix}-${active}`,
  tabIndex: 0,
});

/** A row of tabs with keyboard navigation. */
export function Tabs({ label, tabs, active, onChange, idPrefix = 'tab' }: TabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const last = tabs.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? i === last
          ? 0
          : i + 1
        : e.key === 'ArrowLeft'
          ? i === 0
            ? last
            : i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => (refs.current[i] = el)}
          type="button"
          role="tab"
          id={`${idPrefix}-${t.id}`}
          aria-selected={t.id === active}
          aria-controls={`${idPrefix}-panel-${t.id}`}
          tabIndex={t.id === active ? 0 : -1}
          className={t.id === active ? `${styles.tab} ${styles.active}` : styles.tab}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
          {t.badge !== undefined && <span className={styles.count}>{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}
