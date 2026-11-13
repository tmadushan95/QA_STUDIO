/**
 * Project scope: the project and version every page works in, like an Azure DevOps project and branch.
 *
 * - The **project** comes from the address (`/project/<CODE>/…`), so it is shareable and survives a reload. An old
 *   numeric address is rewritten to the project's code.
 * - The **version** is chosen in the header and remembered per browser (`useWorkContext`); "All versions" is 0.
 * - Pages read both through `useProjectScope()` and never offer their own project picker, so there is one place to
 *   switch and nothing to keep in step.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLive } from '../../shared/api/live.js';
import { useResource } from '../../shared/hooks/useAsync.js';
import { hrefIn, navigate, useRoute } from '../../shared/hooks/useRoute.js';
import { useWorkContext } from '../../shared/hooks/useWorkContext.js';
import { fetchProjects, fetchVersions, type Project, type ProjectVersion } from './api.js';

/** What every page knows about where it works. */
export interface ProjectScopeValue {
  /** The project being worked in; undefined at organization level or while loading. */
  project: Project | undefined;
  projects: Project[];
  /** The project's active versions, newest release first. */
  versions: ProjectVersion[];
  /** The chosen version; undefined for "All versions". */
  version: ProjectVersion | undefined;
  /** The chosen version's key, 0 for "All versions". */
  versionId: number;
  setVersion: (id: number) => void;
  /** Reload projects and versions, for example after one was added. */
  reload: () => void;
  loading: boolean;
}

const Scope = createContext<ProjectScopeValue | undefined>(undefined);

/** Loads projects and versions and keeps the scope in step with the address. */
export function ProjectScopeProvider({ children }: { children: ReactNode }) {
  const route = useRoute();
  const [ctx, setCtx] = useWorkContext();
  const data = useResource(async () => {
    const [projects, versions] = await Promise.all([
      fetchProjects(),
      fetchVersions().catch(() => []),
    ]);
    return { projects, versions };
  });
  useLive((e) => e.type === 'data' && data.reload());

  const projects = data.data?.projects ?? [];
  const project = route.project
    ? projects.find(
        (p) =>
          p.code.toLowerCase() === route.project!.toLowerCase() || String(p.id) === route.project,
      )
    : undefined;

  // The address names the project; remember it, and turn an old numeric address into the readable code.
  useEffect(() => {
    if (!project) return;
    if (project.id !== ctx.projectId) setCtx({ projectId: project.id });
    if (route.project !== project.code) {
      navigate(hrefIn(project.code, route.page, route.sub, route.detail), true);
    }
  }, [project?.id, route.project]);

  // A project just created (or created elsewhere) is not in the list loaded earlier: load once more before saying
  // the address names no project.
  const [retried, setRetried] = useState<string>();
  const unknown = Boolean(route.project && data.data && !project);
  useEffect(() => {
    if (unknown && retried !== route.project) {
      setRetried(route.project);
      data.reload();
    }
  }, [unknown, route.project]);

  const versions = useMemo(
    () => (data.data?.versions ?? []).filter((v) => v.projectId === project?.id && v.isActive),
    [data.data, project?.id],
  );
  const versionId = project && versions.some((v) => v.id === ctx.versionId) ? ctx.versionId : 0;

  const value: ProjectScopeValue = {
    project,
    projects,
    versions,
    version: versions.find((v) => v.id === versionId),
    versionId,
    setVersion: (id) => setCtx({ versionId: id }),
    reload: data.reload,
    loading:
      (data.loading && !data.data) || (unknown && (data.loading || retried !== route.project)),
  };
  return <Scope.Provider value={value}>{children}</Scope.Provider>;
}

/** The project and version the page works in. Outside a provider (some tests), an empty organization scope. */
export function useProjectScope(): ProjectScopeValue {
  return (
    useContext(Scope) ?? {
      project: undefined,
      projects: [],
      versions: [],
      version: undefined,
      versionId: 0,
      setVersion: () => undefined,
      reload: () => undefined,
      loading: false,
    }
  );
}
