import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { ApiError, type Api } from './client.js';
import type { Toolset } from './toolsets.js';

/** Largest text a tool hands back. Bigger answers are cut with a note, so one call cannot flood the agent's context. */
export const MAX_TEXT = 60_000;

/** What every tool module gets. */
export interface ToolContext {
  server: McpServer;
  api: Api;
  /** Toolsets turned on for this server. A module registers only the tools of these sets. */
  toolsets: ReadonlySet<Toolset>;
  /** Project the agent works in when it does not name one (`QA_MCP_PROJECT_ID`). */
  defaultProjectId?: number | undefined;
}

/** Annotation presets. Clients use them to decide what to confirm with the person. */
export const READ: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};
export const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
export const REPLACE: ToolAnnotations = { ...WRITE, idempotentHint: true };
/** Drives real browsers against the QA environment, or writes to Azure DevOps. */
export const EXTERNAL: ToolAnnotations = { ...WRITE, openWorldHint: true };
export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

const HINTS: Record<string, string> = {
  'worker-unavailable': 'To start it: npm start in Backend/Worker.',
  'route-not-found':
    'The worker is older than the API; restart QA Studio so both run the same version.',
  'ai-unavailable': 'AI is not set up; add a model key in Settings › AI assistant.',
  'azure-devops-not-configured': 'Connect Azure DevOps in Settings › Azure DevOps first.',
};

/** A successful answer: readable JSON text plus the same data as `structuredContent` for clients that use it. */
export function done(value: unknown): CallToolResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const structured =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { result: value };
  // A cut answer is no longer valid JSON, so it goes out as text only.
  if (text.length > MAX_TEXT) {
    return {
      content: [
        {
          type: 'text',
          text: `${text.slice(0, MAX_TEXT)}\n… (cut at ${MAX_TEXT} characters; ask for less, for example with a smaller limit)`,
        },
      ],
    };
  }
  return { content: [{ type: 'text', text }], structuredContent: structured };
}

/** A failed answer. The platform's own message is kept word for word; a known code adds what to do next. */
export function fail(e: unknown): CallToolResult {
  const message = e instanceof Error ? e.message : 'The request failed.';
  const hint = e instanceof ApiError && e.code ? HINTS[e.code] : undefined;
  return {
    content: [{ type: 'text', text: hint ? `${message}\n${hint}` : message }],
    isError: true,
  };
}

/** Runs a tool body and turns any thrown error into a tool error, so the agent can read it and try again. */
export async function guard(body: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return done(await body());
  } catch (e) {
    return fail(e);
  }
}

/** A query string from the values that are set. */
export function q(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const enc = encodeURIComponent;

/** `{ items: [...] }` → the list; anything else → an empty list. */
export function itemsOf<T>(value: unknown): T[] {
  const items = (value as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as T[]) : Array.isArray(value) ? (value as T[]) : [];
}
