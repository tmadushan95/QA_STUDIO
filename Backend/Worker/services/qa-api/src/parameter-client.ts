/**
 * The worker's side of parameter values, which the API owns and stores in tables. The worker asks for them when a run starts
 * (so no copy can go stale), and for backups, "clear all data" and the Azure DevOps pipeline's auto-fill. It also answers the
 * API's one question for the AI (see `registerInternalAi` in internal-sync.ts).
 */
import { HttpError } from './errors.js';

export type CaseValues = Record<string, Record<string, string>>;

/** What auto-fill did, as the API reports it. */
export interface AutoConfigured {
  configured: number;
  filled: number;
  stillMissing: { caseId: string; needed: number; missing: string[] }[];
}

/** What the worker asks of the API about parameters. Implemented by `ParameterClient`; tests use a small fake. */
export interface ParameterApi {
  /** The values each case will run with (its own over its project's common). Throws when they cannot be had. */
  effective(caseIds: string[]): Promise<CaseValues>;
  /** Every case's own values, for a backup. */
  exportAll(): Promise<CaseValues>;
  /** Put a backup's values back; each case in it gets exactly those values. */
  importAll(values: CaseValues): Promise<void>;
  /** Remove every case's own values. Returns how many cases had some. */
  clear(): Promise<number>;
  /** Fill and save the missing values of many cases. */
  autoConfigure(caseIds: string[], ai: boolean): Promise<AutoConfigured>;
}

export interface ParameterClientOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  /** Milliseconds before a request is given up (a run must not hang on a stopped API). */
  timeoutMs?: number;
}

export class ParameterClient implements ParameterApi {
  private readonly f: typeof fetch;

  constructor(private readonly o: ParameterClientOptions) {
    this.f = o.fetch ?? fetch;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.f(new URL(`/internal/persistence/parameters${path}`, this.o.baseUrl), {
        method,
        headers: { 'x-qa-internal-token': this.o.token, 'content-type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 120_000),
      });
    } catch {
      throw new HttpError(
        503,
        'parameters-unavailable',
        'The parameter values could not be read from the QA Studio API. Check that it is running, then try again.',
      );
    }
    if (!res.ok) {
      throw new HttpError(
        503,
        'parameters-unavailable',
        `The QA Studio API refused the parameter request (${res.status}).`,
      );
    }
    return (await res.json()) as T;
  }

  async effective(caseIds: string[]): Promise<CaseValues> {
    if (caseIds.length === 0) return {};
    return (await this.call<{ items: CaseValues }>('POST', '/effective', { caseIds })).items;
  }

  async exportAll(): Promise<CaseValues> {
    return (await this.call<{ items: CaseValues }>('GET', '/export')).items;
  }

  async importAll(values: CaseValues): Promise<void> {
    await this.call('POST', '/import', { values });
  }

  async clear(): Promise<number> {
    return (await this.call<{ deleted: number }>('DELETE', '')).deleted;
  }

  autoConfigure(caseIds: string[], ai: boolean): Promise<AutoConfigured> {
    return this.call<AutoConfigured>('POST', '/auto', { caseIds, ai });
  }
}
