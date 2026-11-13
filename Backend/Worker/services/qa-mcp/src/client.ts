/**
 * A small HTTP client for the running QA platform. The MCP server holds no data of its own: every tool goes through
 * the platform's API, so the same validation, audit trail, access token and safety switches apply.
 */
export interface Api {
  get(path: string): Promise<unknown>;
  send(method: 'POST' | 'PUT', path: string, body: unknown): Promise<unknown>;
}

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    message: string,
    readonly status: number,
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
      parsed = undefined;
    }
    if (!res.ok) {
      const msg = (parsed as { error?: { message?: string } } | undefined)?.error?.message;
      throw new ApiError(
        res.status === 401
          ? 'The QA platform needs an access token. Set QA_ADMIN_TOKEN for the MCP server.'
          : (msg ?? `The QA platform answered ${res.status}.`),
        res.status,
      );
    }
    return parsed;
  };
  return { get: (p) => call('GET', p), send: (m, p, b) => call(m, p, b) };
}
