import type { AutoConfigured, CaseValues, ParameterApi } from './parameter-client.js';

/**
 * A stand-in for the API's parameter routes, for tests: values held in memory, with the same rules the API applies (an import
 * gives each case in it exactly those values; effective values are a case's own over its project's common ones).
 */
export function fakeParameters(
  initial: CaseValues = {},
  o: {
    projectOf?: (caseId: string) => number | undefined;
    common?: Record<number, Record<string, string>>;
  } = {},
): ParameterApi & { values: CaseValues; asked: string[][]; failWith: Error | undefined } {
  const api = {
    values: structuredClone(initial) as CaseValues,
    asked: [] as string[][],
    failWith: undefined as Error | undefined,
    effective(caseIds: string[]) {
      if (api.failWith) return Promise.reject(api.failWith);
      api.asked.push(caseIds);
      return Promise.resolve(
        Object.fromEntries(
          caseIds.map((id) => {
            const project = o.projectOf?.(id);
            return [
              id,
              { ...(project === undefined ? {} : o.common?.[project]), ...api.values[id] },
            ];
          }),
        ),
      );
    },
    exportAll: () => Promise.resolve(structuredClone(api.values)),
    importAll(values: CaseValues) {
      for (const [id, v] of Object.entries(values)) api.values[id] = { ...v };
      return Promise.resolve();
    },
    clear() {
      const n = Object.keys(api.values).length;
      api.values = {};
      return Promise.resolve(n);
    },
    autoConfigure(): Promise<AutoConfigured> {
      return Promise.resolve({ configured: 0, filled: 0, stillMissing: [] });
    },
  };
  return api;
}
