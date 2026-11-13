/**
 * StickyBar organism: keeps a page's filters and bulk actions in view under the top bar while the list scrolls.
 * It reports its own height, so a table below can stop its sticky header just underneath it.
 * On phones it scrolls with the page instead, so it never covers most of a small screen.
 *
 * @example
 * const [barHeight, setBarHeight] = useState(0);
 * <StickyBar onHeight={setBarHeight}>…filters…</StickyBar>
 * <DataTable stickyHeaderTop={stickyBelow(barHeight)} … />
 */
import { useEffect, useRef, type ReactNode } from 'react';
import styles from './StickyBar.module.css';

/** The `top` for a sticky table header placed right under a StickyBar of the given height. */
export const stickyBelow = (barHeight: number) => `calc(var(--topbar-height) + ${barHeight}px)`;

/** Props of `StickyBar`. */
export interface StickyBarProps {
  children: ReactNode;
  /** Called with the bar's height in pixels whenever it changes (filters wrap, a bulk bar appears). */
  onHeight?: (height: number) => void;
}

/** A bar that stays at the top while the page scrolls, and reports its height. */
export function StickyBar({ children, onHeight }: StickyBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const report = useRef(onHeight);
  report.current = onHeight;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => report.current?.(Math.ceil(el.getBoundingClientRect().height));
    measure();
    // Not every environment has ResizeObserver (tests run in jsdom); the first measure is then all we get.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={styles.bar}>
      {children}
    </div>
  );
}
