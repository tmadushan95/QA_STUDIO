import { z } from 'zod';
import { enc, guard, READ, REPLACE, WRITE, type ToolContext } from '../result.js';

/** The same names the platform treats as secret when it guesses parameter values (ParameterGuess.cs). */
const SECRET_NAME = /pass(word)?|secret|token|api.?key|pin\b/i;
export const HIDDEN = '[hidden]';
/** Fields that describe a parameter rather than hold its value. */
const DESCRIBING = new Set(['name', 'source', 'caseId', 'type', 'description']);

/**
 * Masks secret-looking parameter values in an answer, in both shapes the API uses: `{ password: "x" }` and
 * `{ name: "password", value: "x" }`. Test data is fine for the agent to read; a password is not.
 */
export function hideSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(hideSecrets);
  if (value === null || typeof value !== 'object') return value;
  const o = value as Record<string, unknown>;
  const named = typeof o['name'] === 'string' && SECRET_NAME.test(o['name']);
  return Object.fromEntries(
    Object.entries(o).map(([k, v]) => {
      // A secret-named parameter can carry its value in several fields (value, common, effective…): hide them all.
      const secret =
        typeof v === 'string' && v !== '' && (SECRET_NAME.test(k) || (named && !DESCRIBING.has(k)));
      return [k, secret ? HIDDEN : hideSecrets(v)];
    }),
  );
}

const CaseId = z.string().trim().min(1).max(200);
const ProjectId = z.number().int().positive();
// Plain strings, not nullable ones: a nullable value becomes `anyOf` in JSON Schema, which some clients reject.
const Values = z
  .record(z.string().min(1).max(200), z.string().max(4000))
  .describe(
    'Parameter name → value. An empty string clears a value. Never put a real password here.',
  );

/** The API clears a value on null. */
const toApi = (values: Record<string, string>) =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === '' ? null : v]));

/**
 * Test data: the `{{data.name}}` values steps use. Common parameters belong to a project; case parameters override
 * them for one test case.
 */
export function registerParameterTools(ctx: ToolContext): void {
  const { server, api, toolsets } = ctx;

  server.registerTool(
    'get_parameter_summary',
    {
      title: 'Parameter summary',
      description:
        'For every test case: which parameters its steps use and which still have no value.',
      annotations: READ,
    },
    () => guard(async () => hideSecrets(await api.get('/api/parameters'))),
  );

  server.registerTool(
    'get_case_parameters',
    {
      title: "Get a test case's parameters",
      description:
        'The parameters one test case uses, with its own values and the project values it inherits. Secret values are hidden.',
      inputSchema: { caseId: CaseId },
      annotations: READ,
    },
    ({ caseId }) => guard(async () => hideSecrets(await api.get(`/api/parameters/${enc(caseId)}`))),
  );

  server.registerTool(
    'get_common_parameters',
    {
      title: "Get a project's common parameters",
      description:
        'Values every test case of a project shares, such as the base URL or a customer name. Secret values are hidden.',
      inputSchema: { projectId: ProjectId },
      annotations: READ,
    },
    ({ projectId }) =>
      guard(async () => hideSecrets(await api.get(`/api/parameters/common/${projectId}`))),
  );

  if (!toolsets.has('author')) return;

  server.registerTool(
    'set_case_parameters',
    {
      title: "Set a test case's parameters",
      description:
        'Set or clear parameter values for one test case. Names you leave out keep their values.',
      inputSchema: { caseId: CaseId, values: Values },
      annotations: REPLACE,
    },
    ({ caseId, values }) =>
      guard(async () =>
        hideSecrets(
          await api.send('PUT', `/api/parameters/${enc(caseId)}`, { values: toApi(values) }),
        ),
      ),
  );

  server.registerTool(
    'set_common_parameters',
    {
      title: "Set a project's common parameters",
      description: 'Set or clear values every test case of the project shares.',
      inputSchema: { projectId: ProjectId, values: Values },
      annotations: REPLACE,
    },
    ({ projectId, values }) =>
      guard(async () =>
        hideSecrets(
          await api.send('PUT', `/api/parameters/common/${projectId}`, { values: toApi(values) }),
        ),
      ),
  );

  server.registerTool(
    'suggest_case_parameters',
    {
      title: 'Suggest parameter values for a test case',
      description:
        "Proposes values for a case's empty parameters from its text (and the AI when ai is true). Saves nothing; use set_case_parameters to keep them.",
      inputSchema: { caseId: CaseId, ai: z.boolean().optional() },
      annotations: READ,
    },
    ({ caseId, ai }) =>
      guard(async () =>
        hideSecrets(
          await api.send('POST', `/api/parameters/${enc(caseId)}/suggest`, { ai: ai ?? false }),
        ),
      ),
  );

  server.registerTool(
    'suggest_common_parameters',
    {
      title: 'Suggest common parameter values',
      description: "Proposes values for a project's empty common parameters. Saves nothing.",
      inputSchema: { projectId: ProjectId },
      annotations: READ,
    },
    ({ projectId }) =>
      guard(async () =>
        hideSecrets(await api.send('POST', `/api/parameters/common/${projectId}/suggest`, {})),
      ),
  );

  server.registerTool(
    'auto_fill_parameters',
    {
      title: 'Fill missing parameters',
      description:
        'Fills the empty parameters of the given cases (or of every case) with guessed values, using the AI when ai is true. Secret-looking names are never filled. Returns what is still missing.',
      inputSchema: { caseIds: z.array(CaseId).max(500).optional(), ai: z.boolean().optional() },
      annotations: WRITE,
    },
    ({ caseIds, ai }) =>
      guard(async () =>
        hideSecrets(
          await api.send('POST', '/api/parameters/auto', {
            ...(caseIds && { caseIds }),
            ai: ai ?? false,
          }),
        ),
      ),
  );
}
