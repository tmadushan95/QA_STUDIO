/**
 * The header's scope switchers, like Azure DevOps' project and branch pickers:
 * Projects › [Shop App ▾] › [Version 2.4 ▾]
 *
 * - The project switcher lists every project; choosing one opens the same page in that project. "All projects" goes
 *   back to the project list.
 * - The version switcher lists the project's versions ("All versions" first); "Manage versions" opens the project's
 *   settings, where versions are added.
 */
import { Icon, Menu } from '../../design-system/index.js';
import { href, hrefIn, isProjectPage, navigate, useRoute } from '../../shared/hooks/useRoute.js';
import { useProjectScope } from './ProjectScope.js';
import styles from './ScopeSwitchers.module.css';

/** Projects › project ▾ › version ▾ */
export function ScopeSwitchers() {
  const route = useRoute();
  const scope = useProjectScope();
  const { project } = scope;
  if (!project) return null;
  const samePage = isProjectPage(route.page) ? route.page : 'dashboard';
  return (
    <nav className={styles.crumbs} aria-label="Project and version">
      <a className={styles.home} href={href('home')}>
        <Icon name="folder" size={16} />
        <span>Projects</span>
      </a>
      <span className={styles.sep} aria-hidden="true">
        /
      </span>
      <Menu
        label={`Project: ${project.name}. Switch project`}
        triggerLabel={project.name}
        items={[
          ...scope.projects
            .filter((p) => p.isActive || p.id === project.id)
            .map((p) => ({
              label: p.id === project.id ? `${p.name} ✓` : p.name,
              icon: 'folder' as const,
              onSelect: () => navigate(hrefIn(p.code, samePage)),
            })),
          { label: 'All projects', icon: 'left' as const, onSelect: () => navigate('/') },
        ]}
      />
      <span className={styles.sep} aria-hidden="true">
        /
      </span>
      <Menu
        label={`Version: ${scope.version?.name ?? 'all versions'}. Switch version`}
        triggerLabel={scope.version ? `v${scope.version.name}` : 'All versions'}
        items={[
          {
            label: scope.versionId === 0 ? 'All versions ✓' : 'All versions',
            icon: 'version' as const,
            onSelect: () => scope.setVersion(0),
          },
          ...scope.versions.map((v) => ({
            label: `${v.name}${v.isCurrent ? ' (current)' : ''}${v.id === scope.versionId ? ' ✓' : ''}`,
            icon: 'version' as const,
            onSelect: () => scope.setVersion(v.id),
          })),
          {
            label: 'Manage versions',
            icon: 'settings' as const,
            onSelect: () => navigate(hrefIn(project.code, 'project-settings', 'versions')),
          },
        ]}
      />
    </nav>
  );
}
