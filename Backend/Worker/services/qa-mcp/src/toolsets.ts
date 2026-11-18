/**
 * Groups of tools a team turns on with `QA_MCP_TOOLSETS`. A tool outside the chosen sets is never registered, so the
 * agent does not even see it.
 *
 * - `read`: looks things up; always on.
 * - `author`: writes that stay reviewable (test cases, parameters, scenario drafts, AI proposals).
 * - `operate`: runs approved scenarios in real browsers against the QA environment.
 * - `defects`: files bugs in Azure DevOps Boards from failed runs.
 * - `admin`: deletes; every call needs the target named again, and a confirmation where the client can ask.
 */
export const TOOLSETS = ['read', 'author', 'operate', 'defects', 'admin'] as const;
export type Toolset = (typeof TOOLSETS)[number];

export const DEFAULT_TOOLSETS: readonly Toolset[] = ['read', 'author', 'operate'];

const isToolset = (s: string): s is Toolset => (TOOLSETS as readonly string[]).includes(s);

/** Parses `QA_MCP_TOOLSETS` (comma separated). `read` is always included; an unknown name is a startup error. */
export function parseToolsets(value: string | undefined): Set<Toolset> {
  const names = (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const unknown = names.filter((n) => !isToolset(n));
  if (unknown.length > 0) {
    throw new Error(
      `QA_MCP_TOOLSETS has unknown toolsets: ${unknown.join(', ')}. Use any of: ${TOOLSETS.join(', ')}.`,
    );
  }
  const chosen = names.length > 0 ? names.filter(isToolset) : [...DEFAULT_TOOLSETS];
  return new Set<Toolset>(['read', ...chosen]);
}
