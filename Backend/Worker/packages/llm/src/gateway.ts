import type { ZodType } from 'zod';
import { AnthropicClient } from './anthropic.js';
import { GeminiClient } from './gemini.js';
import type { FetchLike } from './http.js';
import {
  LlmError,
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
  type Provider,
} from './types.js';

export function createClient(o: {
  provider: Provider;
  apiKey: string;
  model: string;
  fetch?: FetchLike;
}): LlmClient {
  const base = { apiKey: o.apiKey, model: o.model, ...(o.fetch && { fetch: o.fetch }) };
  return o.provider === 'anthropic' ? new AnthropicClient(base) : new GeminiClient(base);
}

export interface CallRecord {
  provider: string;
  model: string;
  inputChars: number;
  usage: LlmResponse['usage'];
  ms: number;
  ok: boolean;
  /** The error kind when it failed. Never the prompt or the answer. */
  error?: string;
}

export interface GatewayOptions {
  /** Most calls one gateway (one agent task) may make. Stops a runaway loop from spending without limit. */
  maxCalls?: number;
  /** Largest prompt, in characters, that may be sent. */
  maxInputChars?: number;
  /** Highest `maxTokens` a caller may ask for. */
  maxOutputTokens?: number;
  /** Retries after a rate limit, server error or network failure. */
  retries?: number;
  /** Values that must never leave the machine (test-account passwords, the API keys). Replaced before sending. */
  secrets?: () => string[];
  /** Called after every call with sizes and timing only, for the audit log. */
  onCall?: (r: CallRecord) => void;
  sleep?: (ms: number) => Promise<void>;
}

const MASK = '[redacted]';

/**
 * The one door to a model. Adds what every caller needs and none should reimplement: secret scrubbing, size and call
 * budgets, retry with backoff, and an audit record that holds sizes, never content.
 */
export class LlmGateway {
  private calls = 0;
  private readonly o: Required<Omit<GatewayOptions, 'secrets' | 'onCall'>> &
    Pick<GatewayOptions, 'secrets' | 'onCall'>;

  constructor(
    private readonly client: LlmClient,
    opts: GatewayOptions = {},
  ) {
    this.o = {
      maxCalls: opts.maxCalls ?? 20,
      maxInputChars: opts.maxInputChars ?? 120_000,
      maxOutputTokens: opts.maxOutputTokens ?? 4096,
      retries: opts.retries ?? 2,
      sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      ...(opts.secrets && { secrets: opts.secrets }),
      ...(opts.onCall && { onCall: opts.onCall }),
    };
  }

  get info(): { provider: string; model: string } {
    return { provider: this.client.provider, model: this.client.model };
  }

  get callCount(): number {
    return this.calls;
  }

  private scrub(text: string): string {
    // Longest first, so a secret that contains a shorter one is masked whole.
    const secrets = (this.o.secrets?.() ?? [])
      .filter((s) => s.length >= 4)
      .sort((a, b) => b.length - a.length);
    return secrets.reduce((t, s) => t.split(s).join(MASK), text);
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const safe: LlmRequest = {
      ...req,
      maxTokens: Math.min(req.maxTokens, this.o.maxOutputTokens),
      ...(req.system !== undefined && { system: this.scrub(req.system) }),
      messages: req.messages.map((m) => ({ ...m, content: this.scrub(m.content) })),
    };
    const inputChars = safe.messages.reduce(
      (n, m) => n + m.content.length,
      safe.system?.length ?? 0,
    );
    if (inputChars > this.o.maxInputChars) {
      throw new LlmError(
        'budget',
        `The prompt is too large to send (${inputChars} characters, limit ${this.o.maxInputChars}). Select fewer test cases.`,
      );
    }

    for (let attempt = 0; ; attempt++) {
      if (this.calls >= this.o.maxCalls) {
        throw new LlmError(
          'budget',
          `This task reached its limit of ${this.o.maxCalls} model calls.`,
        );
      }
      this.calls++;
      const started = Date.now();
      try {
        const res = await this.client.complete(safe);
        this.o.onCall?.({
          provider: res.provider,
          model: res.model,
          inputChars,
          usage: res.usage,
          ms: Date.now() - started,
          ok: true,
        });
        return res;
      } catch (e) {
        const err =
          e instanceof LlmError
            ? e
            : new LlmError('network', e instanceof Error ? e.message : String(e));
        this.o.onCall?.({
          provider: this.client.provider,
          model: this.client.model,
          inputChars,
          usage: { inputTokens: 0, outputTokens: 0 },
          ms: Date.now() - started,
          ok: false,
          error: err.kind,
        });
        if (!err.retryable || attempt >= this.o.retries || req.signal?.aborted) throw err;
        await this.o.sleep(500 * 2 ** attempt);
      }
    }
  }
}

/** The JSON object inside an answer, tolerating a code fence or a sentence around it. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const candidate = (fenced ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[{[]/);
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new SyntaxError('No JSON found.');
  }
}

/**
 * Ask for JSON and validate it against `schema`. If the answer does not parse or does not fit, the model is told
 * exactly what was wrong and gets one more try; after that the failure is reported, never guessed around.
 */
export async function completeJson<T>(
  gateway: LlmGateway,
  req: LlmRequest,
  schema: ZodType<T>,
): Promise<{ value: T; response: LlmResponse }> {
  let messages = req.messages;
  let lastProblem = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await gateway.complete({ ...req, messages });
    try {
      const parsed = schema.safeParse(extractJson(response.text));
      if (parsed.success) return { value: parsed.data, response };
      lastProblem = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
    } catch {
      lastProblem = 'The answer was not valid JSON.';
    }
    messages = [
      ...req.messages,
      { role: 'assistant', content: response.text },
      {
        role: 'user',
        content: `That answer was not accepted: ${lastProblem}\nReply again with only the corrected JSON.`,
      },
    ];
  }
  throw new LlmError('invalid-output', `The model did not return usable JSON: ${lastProblem}`);
}
