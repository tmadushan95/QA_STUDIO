/**
 * useCaseLibrary: everything Test Case Studio and Test Execution show about test cases, loaded once and kept live.
 * Each row joins a case with its automation state (scenario), its parameters and its run history, so both pages filter
 * and sort the same data the same way.
 */
import { useMemo } from 'react';
import type { CaseResult } from '@qa-studio/shared';
import { useLive } from '../../shared/api/live.js';
import { useResource } from '../../shared/hooks/useAsync.js';
import { fetchProjects, fetchSuites, fetchVersions } from '../master-data/index.js';
import { fetchRuns, type RunView } from '../runs/api.js';
import {
  fetchAllCases,
  fetchParameterSummary,
  fetchScenarioRows,
  type ScenarioRow,
  type TestCase,
} from './api.js';

/** One list row: the case plus what the lists show about its automation, parameters and results. */
export interface CaseRow {
  tc: TestCase;
  state: ScenarioRow['state'];
  steps: number;
  /** How many parameter names its steps read, and which have no value yet. */
  needed: number;
  missing: string[];
  /** How often the case has run (one result per account per run), and its most recent result. */
  runs: number;
  last: { result: CaseResult; runId: string; at: string } | undefined;
}

/** Filters both pages share. 0 / '' mean "all". */
export interface CaseFilter {
  projectId: number;
  versionId: number;
  suiteId: number;
  query: string;
}

/** Per case: how many results it has and the newest one. Results still queued are not counted. */
export function runStats(runs: RunView[]): Map<string, Pick<CaseRow, 'runs' | 'last'>> {
  const out = new Map<string, Pick<CaseRow, 'runs' | 'last'>>();
  const newestFirst = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const run of newestFirst) {
    for (const result of run.cases) {
      if (result.status === 'queued') continue;
      const s = out.get(result.caseId) ?? { runs: 0, last: undefined };
      s.runs++;
      // The first result met is the newest; within one run the first account's result stands for the run.
      s.last ??= { result, runId: run.id, at: result.startedAt ?? run.startedAt ?? run.createdAt };
      out.set(result.caseId, s);
    }
  }
  return out;
}

/** Whether a row matches the shared filters. */
export function matches(r: CaseRow, f: CaseFilter): boolean {
  const q = f.query.trim().toLowerCase();
  return (
    (!f.projectId || r.tc.projectId === f.projectId) &&
    (!f.versionId || r.tc.projectVersionId === f.versionId) &&
    (!f.suiteId || r.tc.testSuiteId === f.suiteId) &&
    (!q ||
      [r.tc.id, r.tc.title, r.tc.module ?? '', r.tc.testSuiteName ?? ''].some((v) =>
        v.toLowerCase().includes(q),
      ))
  );
}

/** Loads cases, automation states, parameters, master data and runs, and reloads on live changes. */
export function useCaseLibrary() {
  const data = useResource(async () => {
    const [list, scenarios, parameters, projects, suites, versions] = await Promise.all([
      fetchAllCases(),
      fetchScenarioRows(),
      fetchParameterSummary().catch(() => []),
      fetchProjects(),
      fetchSuites(),
      fetchVersions().catch(() => []),
    ]);
    return { list, scenarios, parameters, projects, suites, versions };
  });
  const runs = useResource(fetchRuns);
  // A save, a conversion step, an approval or a run moving on refreshes what it touches.
  useLive((e) => {
    if (e.type === 'run') runs.reload();
    if (e.type === 'data' || (e.type === 'job' && e.status !== 'running')) data.reload();
  });

  const rows = useMemo<CaseRow[]>(() => {
    if (!data.data) return [];
    const byCase = new Map(data.data.scenarios.map((s) => [s.caseId, s]));
    const params = new Map(data.data.parameters.map((p) => [p.caseId, p]));
    const stats = runStats(runs.data ?? []);
    return data.data.list.map((tc) => {
      const s = byCase.get(tc.id);
      const p = params.get(tc.id);
      return {
        tc,
        state: s?.state ?? 'none',
        steps: s?.steps ?? 0,
        needed: p?.needed ?? 0,
        missing: p?.missing ?? [],
        ...(stats.get(tc.id) ?? { runs: 0, last: undefined }),
      };
    });
  }, [data.data, runs.data]);

  return {
    rows,
    projects: data.data?.projects ?? [],
    suites: data.data?.suites ?? [],
    versions: data.data?.versions ?? [],
    runs: runs.data ?? [],
    loading: data.loading && !data.data,
    error: data.error,
    reload: () => {
      data.reload();
      runs.reload();
    },
  };
}
