/**
 * A small HTTP client for the running QA platform. The MCP server holds no data of its own: every tool goes through
 * the platform's API, so the same validation, audit trail, access token and safety switches apply.
 */
export interface Api {
  get(path: string): Promise<unknown>;
  send(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<unknown>;
}

/** Sent on every call so the platform's audit trail can say a change came from an assistant. */
export const CLIENT_HEADER = 'x-qa-client';
export const CLIENT_NAME = 'mcp/0.2.0';

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    message: string,
    readonly status: number,
    /** The platform's error code (`worker-unavailable`, `not-found`, …) when it sent one. */
    readonly code?: string,
  ) {
    super(message);
  }
}

export function httpApi(o: {
  baseUrl: string;
  token?: string | undefined;
  fetch?: typeof fetch;
}): Api {
  const f = o.fetch ?? fetch;
  const base = o.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    accept: 'application/json',
    [CLIENT_HEADER]: CLIENT_NAME,
    ...(o.token && { authorization: `Bearer ${o.token}` }),
  };
  const call = async (method: string, path: string, body?: unknown) => {
    let res: Response;
    try {
      res = await f(`${base}${path}`, {
        method,
        headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new ApiError(
        `The QA platform is not reachable at ${base}. Start it with "qa-studio" or "npm start".`,
        0,
      );
    }
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      // A report or other non-JSON answer: hand the text back as it is.
      parsed = res.ok ? text : undefined;
    }
    if (!res.ok) {
      const error = (parsed as { error?: { message?: string; code?: string } } | undefined)?.error;
      throw new ApiError(
        res.status === 401
          ? 'The QA platform needs an access token. Set QA_ADMIN_TOKEN for the MCP server.'
          : (error?.message ?? `The QA platform answered ${res.status}.`),
        res.status,
        error?.code,
      );
    }
    return parsed;
  };
  return { get: (p) => call('GET', p), send: (m, p, b) => call(m, p, b) };
}
