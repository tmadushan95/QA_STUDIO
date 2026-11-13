import { z } from 'zod';
import {
  DEFAULT_MODELS,
  LlmError,
  LlmGateway,
  PROVIDERS,
  createClient,
  type CallRecord,
  type FetchLike,
  type GatewayOptions,
  type LlmClient,
  type Provider,
} from '@qa-studio/llm';
import { HttpError } from './errors.js';
import type { SecretBox } from './secrets.js';

const MODEL = z
  .string()
  .trim()
  .min(1, 'Enter a model name.')
  .max(100, 'The model name is too long.')
  .regex(/^[\w.\-:/]+$/, 'Use letters, numbers and . - _ : / only.');

const Config = z.object({
  /** Which provider answers. "none" switches every AI feature off. */
  provider: z.enum([...PROVIDERS, 'none']).default('none'),
  anthropic: z
    .object({ model: MODEL.default(DEFAULT_MODELS.anthropic) })
    .default({ model: DEFAULT_MODELS.anthropic }),
  gemini: z
    .object({ model: MODEL.default(DEFAULT_MODELS.gemini) })
    .default({ model: DEFAULT_MODELS.gemini }),
  limits: z
    .object({
      maxOutputTokens: z
        .number()
        .int()
        .min(256, 'At least 256.')
        .max(16_000, 'At most 16000.')
        .default(4096),
      maxCallsPerTask: z.number().int().min(1, 'At least 1.').max(100, 'At most 100.').default(20),
    })
    .default({ maxOutputTokens: 4096, maxCallsPerTask: 20 }),
});
export type AiConfig = z.infer<typeof Config>;

const KEY_RULE = z
  .string()
  .trim()
  .min(8, 'That key is too short.')
  .max(400, 'That key is too long.')
  .regex(/^\S+$/, 'A key has no spaces or line breaks.');

export interface ProviderView {
  model: string;
  hasKey: boolean;
  /** Where the key in use comes from. The key itself is never returned. */
  keySource: 'app' | 'environment' | 'none';
  /** Model names that are known to work, offered as suggestions. The field accepts any name. */
  suggestions: string[];
}

export interface AiView {
  provider: AiConfig['provider'];
  anthropic: ProviderView;
  gemini: ProviderView;
  limits: AiConfig['limits'];
  /** True when the chosen provider has a key, so AI features can run. */
  ready: boolean;
  reason?: string;
}

const SUGGESTIONS: Record<Provider, string[]> = {
  anthropic: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.1-flash-lite'],
};

const ENV_KEYS: Record<Provider, string> = {
  anthropic: 'QA_ANTHROPIC_API_KEY',
  gemini: 'QA_GEMINI_API_KEY',
};

export interface AiStore {
  loadConfig(key: string): unknown;
  saveConfig(key: string, value: unknown): void;
  loadAiKey(provider: string): string | undefined;
  saveAiKey(provider: string, keyEnc: string): void;
  deleteAiKey(provider: string): boolean;
}

export interface AiServiceDeps {
  store: AiStore;
  box: SecretBox;
  env: Record<string, string | undefined>;
  audit(action: string, target: string, detail: string): void;
  /** Passwords and tokens that must never be sent to a model, besides the API keys themselves. */
  extraSecrets?: () => string[];
  fetch?: FetchLike;
  /** For tests: replace the real provider adapters. */
  clientFactory?: (o: { provider: Provider; apiKey: string; model: string }) => LlmClient;
  onCall?: (r: CallRecord) => void;
}

/**
 * The AI configuration: which provider, which model, the spending limits, and the API keys (encrypted at rest, write
 * only: no endpoint ever returns one). The rest of the platform asks this service for a gateway and never sees a key.
 */
export class AiService {
  private config: AiConfig;

  constructor(private readonly d: AiServiceDeps) {
    const parsed = Config.safeParse(d.store.loadConfig('ai') ?? {});
    this.config = parsed.success ? parsed.data : Config.parse({});
  }

  private keyFor(p: Provider): { key: string; source: 'app' | 'environment' } | undefined {
    const enc = this.d.store.loadAiKey(p);
    if (enc) {
      const key = this.d.box.decrypt(enc);
      if (key) return { key, source: 'app' };
    }
    const env = this.d.env[ENV_KEYS[p]]?.trim();
    return env ? { key: env, source: 'environment' } : undefined;
  }

  private providerView(p: Provider): ProviderView {
    const k = this.keyFor(p);
    return {
      model: this.config[p].model,
      hasKey: k !== undefined,
      keySource: k?.source ?? 'none',
      suggestions: SUGGESTIONS[p],
    };
  }

  view(): AiView {
    const provider = this.config.provider;
    const ready = provider !== 'none' && this.keyFor(provider) !== undefined;
    return {
      provider,
      anthropic: this.providerView('anthropic'),
      gemini: this.providerView('gemini'),
      limits: this.config.limits,
      ready,
      ...(!ready && {
        reason:
          provider === 'none'
            ? 'AI is switched off. Choose a provider to turn it on.'
            : `Add an API key for ${provider === 'anthropic' ? 'Anthropic' : 'Gemini'} to use it.`,
      }),
    };
  }

  update(patch: unknown): AiView {
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      throw new HttpError(400, 'invalid-ai-settings', 'Send the AI settings as a JSON object.');
    }
    const src = patch as Record<string, unknown>;
    const merged = {
      provider: src['provider'] ?? this.config.provider,
      anthropic: { ...this.config.anthropic, ...asObject(src['anthropic']) },
      gemini: { ...this.config.gemini, ...asObject(src['gemini']) },
      limits: { ...this.config.limits, ...asObject(src['limits']) },
    };
    const parsed = Config.safeParse(merged);
    if (!parsed.success) {
      const fields = Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join('.'), i.message]),
      );
      throw new HttpError(400, 'invalid-ai-settings', 'Some AI settings need fixing.', fields);
    }
    const before = JSON.stringify(this.config);
    this.config = parsed.data;
    this.d.store.saveConfig('ai', parsed.data);
    if (JSON.stringify(parsed.data) !== before) {
      this.d.audit(
        'ai.update',
        'ai',
        `Provider ${parsed.data.provider}; models ${parsed.data.anthropic.model}, ${parsed.data.gemini.model}.`,
      );
    }
    return this.view();
  }

  setKey(provider: string, key: unknown): AiView {
    const p = this.provider(provider);
    const parsed = KEY_RULE.safeParse(key);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid-key',
        parsed.error.issues[0]?.message ?? 'That key is not valid.',
        {
          key: parsed.error.issues[0]?.message ?? 'That key is not valid.',
        },
      );
    }
    this.d.store.saveAiKey(p, this.d.box.encrypt(parsed.data));
    this.d.audit('ai.key.set', p, 'API key saved.'); // never the key, not even part of it
    return this.view();
  }

  removeKey(provider: string): AiView {
    const p = this.provider(provider);
    if (this.d.store.deleteAiKey(p)) this.d.audit('ai.key.remove', p, 'API key removed.');
    return this.view();
  }

  private provider(name: string): Provider {
    if ((PROVIDERS as readonly string[]).includes(name)) return name as Provider;
    throw new HttpError(404, 'unknown-provider', `Unknown AI provider "${name}".`);
  }

  private client(p: Provider): LlmClient {
    const k = this.keyFor(p);
    if (!k) {
      throw new LlmError(
        'auth',
        `There is no API key for ${p === 'anthropic' ? 'Anthropic' : 'Gemini'}. Add one in Settings.`,
      );
    }
    const o = { provider: p, apiKey: k.key, model: this.config[p].model };
    return this.d.clientFactory
      ? this.d.clientFactory(o)
      : createClient({ ...o, ...(this.d.fetch && { fetch: this.d.fetch }) });
  }

  /** The gateway for the provider chosen in Settings. Throws an LlmError that says what to configure. */
  gateway(overrides: Partial<GatewayOptions> = {}): LlmGateway {
    const p = this.config.provider;
    if (p === 'none')
      throw new LlmError('auth', 'AI is switched off. Choose a provider in Settings.');
    return this.gatewayFor(p, overrides);
  }

  private gatewayFor(p: Provider, overrides: Partial<GatewayOptions> = {}): LlmGateway {
    return new LlmGateway(this.client(p), {
      maxOutputTokens: this.config.limits.maxOutputTokens,
      maxCalls: this.config.limits.maxCallsPerTask,
      secrets: () => [
        ...PROVIDERS.flatMap((x) => this.keyFor(x)?.key ?? []),
        ...(this.d.extraSecrets?.() ?? []),
      ],
      ...(this.d.onCall && { onCall: this.d.onCall }),
      ...overrides,
    });
  }

  /** One tiny request to prove the key and model work. The answer is not stored; the message never contains the key. */
  async test(
    provider?: string,
  ): Promise<{ ok: boolean; message: string; provider: string; model: string; ms: number }> {
    const p = provider
      ? this.provider(provider)
      : this.config.provider === 'none'
        ? undefined
        : this.config.provider;
    if (!p) throw new HttpError(400, 'ai-off', 'Choose a provider first.');
    const started = Date.now();
    try {
      const res = await this.gatewayFor(p, { maxCalls: 1, retries: 0 }).complete({
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        maxTokens: 16,
        temperature: 0,
        timeoutMs: 20_000,
      });
      return {
        ok: true,
        message: `Connected. ${res.model} answered.`,
        provider: p,
        model: res.model,
        ms: Date.now() - started,
      };
    } catch (e) {
      const message = e instanceof LlmError ? e.message : 'The test could not be completed.';
      return {
        ok: false,
        message,
        provider: p,
        model: this.config[p].model,
        ms: Date.now() - started,
      };
    }
  }
}

function asObject(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
