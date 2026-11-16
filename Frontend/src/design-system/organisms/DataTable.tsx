/**
 * DataTable organism: a list of records with optional row selection and paging.
 * On phones each row becomes a card: every cell shows its column name, so nothing scrolls sideways.
 */
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Button } from '../atoms/Button.js';
import { Checkbox } from '../atoms/Inputs.js';
import styles from './DataTable.module.css';

/** One column of a `DataTable`. */
export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Text used for the column label on phones (defaults to `header` when that is a string). */
  label?: string;
  cell: (row: T) => ReactNode;
  /** The row header cell (read first by screen readers); usually the ID or name. */
  rowHeader?: boolean;
  /** Keep the column narrow, such as for a status or the row menu. */
  shrink?: boolean;
  align?: 'start' | 'end';
}

/** Props of `DataTable`. */
export interface DataTableProps<T> {
  /** Accessible name of the table. */
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Turns on row checkboxes. */
  selection?: {
    selected: Set<string>;
    onChange: (next: Set<string>) => void;
    /** Accessible label for one row's checkbox. */
    label: (row: T) => string;
  };
  empty?: ReactNode;
  paging?: { page: number; pageSize: number; total: number; onPage: (page: number) => void };
  /**
   * Keep the column headers visible while the page scrolls. The value is how far from the top of the window they
   * stop (a CSS length), so they sit just below whatever else sticks above them, such as a `StickyBar`.
   */
  stickyHeaderTop?: string;
}

/**
 * Fits a table's rows to the window: publishes `--rows-max-height` (window height minus where the table starts and the
 * pager below it), so the rows scroll inside the table instead of making the whole page scroll. Measured against the
 * document, not the viewport, so scrolling the page does not change it; re-measured when the window or the content
 * above the table changes size. A CSS floor keeps a usable height when the table starts low on the page.
 */
function useFitRowsToWindow(card: RefObject<HTMLDivElement>, enabled: boolean): void {
  useLayoutEffect(() => {
    const el = card.current;
    if (!enabled || !el) return;
    const fit = () => {
      const rowsBox = el.querySelector<HTMLElement>(`.${styles.scroll}`);
      if (!rowsBox) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      // Everything in the card that is not the rows (borders, pager), plus the page's own bottom padding.
      const chrome = el.offsetHeight - rowsBox.offsetHeight;
      const main = el.closest('main');
      const gap = main ? Number.parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      el.style.setProperty(
        '--rows-max-height',
        `${Math.floor(window.innerHeight - top - chrome - gap)}px`,
      );
    };
    fit();
    window.addEventListener('resize', fit);
    // Content above the table can grow or shrink (filters wrap, a banner appears); follow it where supported.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fit);
    observer?.observe(document.body);
    // The body keeps its height when something above the table goes away (a finished run's live strip), so watch the
    // page's own content too.
    const page = el.closest('main')?.firstElementChild;
    if (page) observer?.observe(page);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [card, enabled]);
}

/** A table with optional row selection and paging, and an empty state. */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  selection,
  empty,
  paging,
  stickyHeaderTop,
}: DataTableProps<T>) {
  const keys = rows.map(rowKey);
  const allOnPage = keys.length > 0 && keys.every((k) => selection?.selected.has(k));
  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    for (const k of keys) {
      if (allOnPage) next.delete(k);
      else next.add(k);
    }
    selection.onChange(next);
  };
  const toggle = (k: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (!next.delete(k)) next.add(k);
    selection.onChange(next);
  };

  const card = useRef<HTMLDivElement>(null);
  const showsEmpty = rows.length === 0 && Boolean(empty);
  // A page-sticky table (stickyHeaderTop) keeps its old behaviour and lets the page scroll instead.
  useFitRowsToWindow(card, !showsEmpty && !stickyHeaderTop);

  if (showsEmpty) return <div className={styles.card}>{empty}</div>;

  const pages = paging ? Math.max(1, Math.ceil(paging.total / paging.pageSize)) : 1;
  return (
    <div
      ref={card}
      className={stickyHeaderTop ? `${styles.card} ${styles.sticky}` : styles.card}
      style={stickyHeaderTop ? ({ '--sticky-top': stickyHeaderTop } as CSSProperties) : undefined}
    >
      <div className={styles.scroll}>
        <table className={styles.table}>
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {selection && (
                <th scope="col" className={styles.shrink}>
                  <Checkbox
                    aria-label="Select all on this page"
                    checked={allOnPage}
                    onChange={toggleAll}
                  />
                </th>
              )}
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={[c.shrink && styles.shrink, c.align === 'end' && styles.end]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const k = rowKey(r);
              return (
                <tr key={k} className={selection?.selected.has(k) ? styles.selected : undefined}>
                  {selection && (
                    <td className={styles.shrink}>
                      <Checkbox
                        aria-label={selection.label(r)}
                        checked={selection.selected.has(k)}
                        onChange={() => toggle(k)}
                      />
                    </td>
                  )}
                  {columns.map((c) => {
                    const label = c.label ?? (typeof c.header === 'string' ? c.header : '');
                    const cls = [c.shrink && styles.shrink, c.align === 'end' && styles.end]
                      .filter(Boolean)
                      .join(' ');
                    return c.rowHeader ? (
                      <th key={c.key} scope="row" data-label={label} className={cls}>
                        {c.cell(r)}
                      </th>
                    ) : (
                      <td key={c.key} data-label={label} className={cls}>
                        {c.cell(r)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {paging && paging.total > paging.pageSize && (
        <nav className={styles.pager} aria-label="Pages">
          <span>
            {(paging.page - 1) * paging.pageSize + 1}–
            {Math.min(paging.total, paging.page * paging.pageSize)} of {paging.total}
          </span>
          <div className={styles.pagerButtons}>
            <Button
              size="sm"
              disabled={paging.page <= 1}
              onClick={() => paging.onPage(paging.page - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              disabled={paging.page >= pages}
              onClick={() => paging.onPage(paging.page + 1)}
            >
              Next
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
