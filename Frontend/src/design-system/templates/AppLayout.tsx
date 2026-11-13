/**
 * AppLayout template: the shell around every page.
 *
 * - **Desktop**: a navy sidebar with labelled groups, which can be collapsed to an icon rail (remembered per browser).
 * - **Tablet**: the icon rail by default; hovering or focusing a link shows its name as a tooltip.
 * - **Phone**: the sidebar becomes a drawer opened from the header's menu button, and the most used pages sit in a
 *   bottom bar within thumb reach.
 *
 * The header names where the person is (group › page) and holds context on the right (environment, live status).
 * Navigation uses plain links, so the back button, new tabs and screen-reader link lists all work.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../atoms/Icon.js';
import styles from './AppLayout.module.css';

/** One entry of the main menu. */
export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  href: string;
  /** Group heading the item is listed under, such as "Test design". */
  group?: string;
  /** Shown in the phone's bottom bar (keep it to four or five items). */
  primary?: boolean;
  /** A short count or marker beside the label, such as the number of cases waiting for review. */
  badge?: ReactNode;
}

/** Props of `AppLayout`. */
export interface AppLayoutProps {
  product: string;
  /** One line under the product name, such as "Test automation". */
  tagline?: string;
  /** Where the logo and product name lead, usually the home page. Without it the brand is plain text. */
  homeHref?: string;
  nav: NavItem[];
  /** Group names shown at the foot of the sidebar instead of in order. */
  bottomGroups?: string[];
  active: string;
  /** Right side of the header. */
  topBar?: ReactNode;
  /**
   * Where the person works, shown before the page name (for example Projects / Shop / v2.4 switchers). Replaces the
   * menu group in the header.
   */
  scope?: ReactNode;
  children: ReactNode;
}

const COLLAPSED_KEY = 'qa-studio.sidebar-collapsed';

/** An element ID for a group heading. IDs cannot hold spaces: `aria-labelledby` reads a space as a list separator. */
const groupId = (prefix: string, group: string) =>
  `${prefix}-group-${group.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** The application shell: sidebar or drawer, header, page area and phone bottom bar. */
export function AppLayout({
  product,
  tagline,
  homeHref,
  nav,
  bottomGroups = [],
  active,
  topBar,
  scope,
  children,
}: AppLayoutProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);

  // Keep the order of first appearance, so the caller's list decides the order of groups too.
  const groups = [...new Set(nav.map((n) => n.group ?? ''))];
  const current = nav.find((n) => n.id === active);

  // A navigation closes the drawer; Escape closes it and returns focus to the button that opened it.
  useEffect(() => setDrawerOpen(false), [active]);
  useEffect(() => {
    if (!drawerOpen) return;
    drawer.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setDrawerOpen(false);
      menuButton.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, String(!c));
      } catch {
        // Storage can be blocked (private mode); the choice then lasts for this visit only.
      }
      return !c;
    });
  };

  const link = (n: NavItem) => (
    <li key={n.id}>
      <a
        href={n.href}
        className={n.id === active ? `${styles.navLink} ${styles.active}` : styles.navLink}
        aria-current={n.id === active ? 'page' : undefined}
        title={n.label}
      >
        <Icon name={n.icon} size={20} />
        <span className={styles.navLabel}>{n.label}</span>
        {n.badge !== undefined && n.badge !== 0 && (
          <span className={styles.navBadge}>{n.badge}</span>
        )}
      </a>
    </li>
  );

  // The drawer repeats the sidebar's menu; landmarks must have unique names, so its copy is named apart.
  const navigation = (idPrefix: string, label: string) => (
    <nav aria-label={label} className={styles.nav}>
      {groups.map((g) => (
        <div
          key={g || 'items'}
          className={bottomGroups.includes(g) ? `${styles.group} ${styles.bottom}` : styles.group}
        >
          {g && (
            <span className={styles.groupLabel} id={groupId(idPrefix, g)}>
              {g}
            </span>
          )}
          <ul className={styles.navList} {...(g && { 'aria-labelledby': groupId(idPrefix, g) })}>
            {nav.filter((n) => (n.group ?? '') === g).map(link)}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brandContent = (
    <>
      <span className={styles.logo}>
        <Icon name="logo" size={20} />
      </span>
      <span className={styles.brandText}>
        <span className={styles.product}>{product}</span>
        {tagline && <span className={styles.tagline}>{tagline}</span>}
      </span>
    </>
  );
  // The text is hidden on the icon rail, so the link carries its own name rather than relying on it.
  const brand = homeHref ? (
    <a
      href={homeHref}
      className={styles.brand}
      aria-label={`${product} home`}
      title={`${product} home`}
    >
      {brandContent}
    </a>
  ) : (
    <div className={styles.brand}>{brandContent}</div>
  );

  return (
    <div className={collapsed ? `${styles.shell} ${styles.collapsed}` : styles.shell}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>

      <aside className={styles.sidebar}>
        {brand}
        {navigation('nav', 'Main')}
        <button
          type="button"
          className={styles.collapse}
          onClick={toggleCollapsed}
          aria-pressed={collapsed}
          title={collapsed ? 'Expand the menu' : 'Collapse the menu'}
        >
          <Icon name={collapsed ? 'right' : 'left'} size={18} />
          <span className={styles.navLabel}>{collapsed ? 'Expand' : 'Collapse'}</span>
        </button>
      </aside>

      {/* Phone drawer: the same menu over the page. Rendered only while open, so its links are never hidden-yet-focusable. */}
      {drawerOpen && (
        <>
          <div className={styles.scrim} onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <aside ref={drawer} className={styles.drawer} aria-label="Menu">
            <div className={styles.drawerHead}>
              {brand}
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => {
                  setDrawerOpen(false);
                  menuButton.current?.focus();
                }}
                aria-label="Close the menu"
              >
                <Icon name="close" />
              </button>
            </div>
            {navigation('drawer', 'Main menu')}
          </aside>
        </>
      )}

      <div className={styles.main}>
        <header className={styles.topBar}>
          <button
            ref={menuButton}
            type="button"
            className={`${styles.iconButton} ${styles.menuButton}`}
            onClick={() => setDrawerOpen(true)}
            aria-label="Open the menu"
            aria-expanded={drawerOpen}
          >
            <Icon name="menu" />
          </button>
          <div className={scope ? `${styles.where} ${styles.scoped}` : styles.where}>
            {scope}
            {!scope && current?.group && <span className={styles.crumb}>{current.group}</span>}
            <span className={styles.pageName}>{current?.label ?? product}</span>
          </div>
          <div className={styles.topBarEnd}>{topBar}</div>
        </header>
        <main id="main" className={styles.content} tabIndex={-1}>
          {children}
        </main>
      </div>

      <nav aria-label="Quick" className={styles.bottomBar}>
        <ul>
          {nav
            .filter((n) => n.primary)
            .map((n) => (
              <li key={n.id}>
                <a
                  href={n.href}
                  className={n.id === active ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                  aria-current={n.id === active ? 'page' : undefined}
                >
                  <Icon name={n.icon} size={20} />
                  <span>{n.label}</span>
                </a>
              </li>
            ))}
          <li>
            <button type="button" className={styles.tab} onClick={() => setDrawerOpen(true)}>
              <Icon name="menu" size={20} />
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
