import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every route a tool or resource calls must exist in the .NET API (ApiRoutes.cs + its endpoints) or the worker
 * (qa-api app.ts). A renamed or moved route then fails here instead of failing an agent at run time, which is how
 * the old `/api/inventory` drift went unnoticed.
 */
const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const SRC = here('./');
const API = here('../../../../src/API/');
const WORKER_APP = here('../../qa-api/src/app.ts');

const read = (file: string) => readFileSync(file, 'utf8');
const filesUnder = (dir: string, ext: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? filesUnder(join(dir, e.name), ext)
      : e.name.endsWith(ext)
        ? [join(dir, e.name)]
        : [],
  );

interface Route {
  method: string;
  path: string;
}

/** `api.get(\`/api/x/${id}${q(...)}\`)` and `api.send('PUT', ...)` calls, with parameters as `X` and no query. */
function toolRoutes(): (Route & { file: string })[] {
  const call = /api\.(get|send)\(\s*(?:'(POST|PUT|DELETE)',\s*)?([`'])(\/api[^`']*)\3/g;
  return filesUnder(SRC, '.ts')
    .filter((f) => !f.endsWith('.test.ts'))
    .flatMap((file) =>
      [...read(file).matchAll(call)].map((m) => ({
        file,
        method: m[1] === 'get' ? 'GET' : m[2]!,
        path: m[4]!.split('${q(')[0]!.replace(/\$\{[^}]*\}/g, 'X'),
      })),
    );
}

/** Routes the .NET API maps itself, from ApiRoutes.cs constants and the endpoints' Map calls. */
function dotnetRoutes(): Route[] {
  const constants = new Map<string, string>();
  for (const m of read(join(API, 'Common', 'ApiRoutes.cs')).matchAll(
    /public const string (\w+) = ([^;]+);/g,
  )) {
    const value = m[2]!
      .split('+')
      .map((part) => part.trim())
      .map((part) => (part.startsWith('"') ? part.slice(1, -1) : (constants.get(part) ?? '')))
      .join('');
    constants.set(m[1]!, value);
  }
  return filesUnder(join(API, 'Endpoints'), '.cs').flatMap((file) =>
    [
      ...read(file).matchAll(/Map(Get|Post|Put|Delete)\(ApiRoutes\.(\w+)(?:\s*\+\s*"([^"]*)")?/g),
    ].map((m) => ({
      method: m[1]!.toUpperCase(),
      path: `${constants.get(m[2]!) ?? ''}${m[3] ?? ''}`.replace(/\{[^}]+\}/g, ':p'),
    })),
  );
}

/** Routes the worker serves (the API forwards every /api route it does not map itself). */
function workerRoutes(): Route[] {
  return [
    ...read(WORKER_APP).matchAll(/app\.(get|post|put|delete)(?:<[^>]*>)?\(\s*'(\/api[^']*)'/g),
  ].map((m) => ({ method: m[1]!.toUpperCase(), path: m[2]!.replace(/:\w+/g, ':p') }));
}

const matches = (known: Route, used: Route) =>
  known.method === used.method &&
  new RegExp(`^${known.path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/:p/g, '[^/]+')}$`).test(
    used.path,
  );

describe('routes the MCP server calls', () => {
  it('finds the routes on both sides (guards the parsing itself)', () => {
    expect(toolRoutes().length).toBeGreaterThan(40);
    expect(dotnetRoutes()).toContainEqual({ method: 'GET', path: '/api/test-cases/:p' });
    expect(workerRoutes()).toContainEqual({ method: 'PUT', path: '/api/scenarios/:p/draft' });
  });

  it('all exist in the .NET API or the worker', () => {
    const known = [...dotnetRoutes(), ...workerRoutes()];
    const missing = toolRoutes()
      .filter((used) => !known.some((k) => matches(k, used)))
      .map((r) => `${r.method} ${r.path} (${r.file.slice(SRC.length)})`);
    expect(missing).toEqual([]);
  });

  it("never call the worker's old test case store", () => {
    expect(toolRoutes().filter((r) => r.path.startsWith('/api/inventory'))).toEqual([]);
  });
});
