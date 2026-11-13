/**
 * SettingsLayout template: a sub-menu of setting sections on the left and one section on the right, so each topic
 * has its own short page instead of one long form. On phones the sub-menu becomes a scrolling row of links.
 */
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../atoms/Icon.js';
import styles from './SettingsLayout.module.css';

/** One entry of the sub-menu. */
export interface SettingsSection {
  id: string;
  label: string;
  icon: IconName;
  href: string;
}

/** A sub-menu on the left with one section on the right. */
export function SettingsLayout({
  sections,
  active,
  label = 'Settings sections',
  children,
}: {
  sections: SettingsSection[];
  active: string;
  /** Names the sub-menu for screen readers, so two pages using this layout are told apart. */
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.layout}>
      <nav aria-label={label} className={styles.nav}>
        <ul>
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={s.href}
                aria-current={s.id === active ? 'page' : undefined}
                className={s.id === active ? `${styles.link} ${styles.active}` : styles.link}
              >
                <Icon name={s.icon} size={16} />
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
