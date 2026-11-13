/**
 * The work context: the project and project version a tester is working on. Test Case Studio and Test Execution share it,
 * so choosing "Shop app · 2.4" on one page carries over to the other, and new cases are filed under it.
 *
 * Kept in the browser (localStorage) per person; it is a convenience, never data. If storage is blocked the context
 * simply lasts for the visit.
 */
import { useCallback, useEffect, useState } from 'react';

/** Project and version; 0 means "all". */
export interface WorkContext {
  projectId: number;
  versionId: number;
}

const KEY = 'qa-studio.work-context';
const EVENT = 'qa-work-context';
const EMPTY: WorkContext = { projectId: 0, versionId: 0 };

function read(): WorkContext {
  try {
    const raw = JSON.parse(
      window.localStorage.getItem(KEY) ?? 'null',
    ) as Partial<WorkContext> | null;
    return {
      projectId: Number(raw?.projectId) || 0,
      versionId: Number(raw?.versionId) || 0,
    };
  } catch {
    return EMPTY;
  }
}

/** The current context and a setter. A change of project clears the version, since a version belongs to one project. */
export function useWorkContext(): [WorkContext, (next: Partial<WorkContext>) => void] {
  const [ctx, setCtx] = useState<WorkContext>(read);

  // Pages open at the same time (or in two tabs) stay in step.
  useEffect(() => {
    const sync = () => setCtx(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const update = useCallback((next: Partial<WorkContext>) => {
    setCtx((prev) => {
      const merged: WorkContext = {
        projectId: next.projectId ?? prev.projectId,
        versionId:
          next.projectId !== undefined && next.projectId !== prev.projectId
            ? (next.versionId ?? 0)
            : (next.versionId ?? prev.versionId),
      };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(merged));
      } catch {
        // Storage blocked: the context lasts for this visit only.
      }
      window.dispatchEvent(new Event(EVENT));
      return merged;
    });
  }, []);

  return [ctx, update];
}
