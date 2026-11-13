import { LlmError, type LlmErrorKind } from './types.js';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const kindForStatus = (status: number): LlmErrorKind =>
  status === 401 || status === 403
    ? 'auth'
    : status === 429
      ? 'rate-limit'
      : status >= 500
        ? 'server'
        : 'bad-request';

/** Keep a provider's message readable and short, and never let a key travel in it. */
export function scrub(text: string, key: string): string {
  const clean = key ? text.split(key).join('[key]') : text;
  return clean.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * POST JSON and return the parsed body. Network failure, timeout and error statuses all become an LlmError whose
 * message says what to do, and none of them contains the API key.
 */
export async function postJson(
  fetchFn: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: { key: string; timeoutMs: number; signal?: AbortSignal | undefined },
): Promise<unknown> {
  const timer = new AbortController();
  const timeout = setTimeout(() => timer.abort(), opts.timeoutMs);
  const onAbort = () => timer.abort();
  opts.signal?.addEventListener('abort', onAbort);
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: timer.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw new LlmError('network', 'The request was cancelled.');
    if (timer.signal.aborted) {
      throw new LlmError(
        'timeout',
        `The model did not answer within ${Math.round(opts.timeoutMs / 1000)} seconds.`,
      );
    }
    throw new LlmError(
      'network',
      `Could not reach the model provider: ${scrub(e instanceof Error ? e.message : String(e), opts.key)}`,
    );
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onAbort);
  }

  let parsed: unknown;
  const raw = await res.text();
  try {
    parsed = raw ? JSON.parse(raw) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!res.ok) {
    const kind = kindForStatus(res.status);
    const detail = providerMessage(parsed) ?? raw;
    const hint =
      kind === 'auth'
        ? 'Check the API key in Settings.'
        : kind === 'rate-limit'
          ? 'The limit or free quota was reached. Wait a little, or switch provider in Settings.'
          : '';
    throw new LlmError(
      kind,
      `${scrub(detail, opts.key) || `The provider answered ${res.status}.`} ${hint}`.trim(),
      res.status,
    );
  }
  return parsed;
}

function providerMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const err = (body as { error?: unknown }).error;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return undefined;
}
