import crypto from 'node:crypto';
import { z } from 'zod';
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk';
import { CASE_FORMATS, COVERAGE_LEVELS } from '@qa-studio/agents';
import { HttpError } from './errors.js';

/**
 * Wake phrases the web app ships a model for (Frontend/public/models/<id>.onnx). A phrase is a trained model, so the
 * list is fixed here rather than free text; adding one means training it and adding the file and an entry.
 */
export const WAKE_PHRASES = [
  { id: 'hey_qa_studio', label: 'Hey QA Studio' },
  { id: 'hey_livekit', label: 'Hey LiveKit' },
] as const;
const WAKE_IDS = WAKE_PHRASES.map((w) => w.id) as [string, ...string[]];

/** Must match the agent name the qa-voice worker registers, or rooms get no agent. */
export const VOICE_AGENT_NAME = 'qa-studio';

/** How long the token is valid for joining. LiveKit refreshes it for a participant that stays connected. */
const TOKEN_TTL_SECONDS = 15 * 60;

const Config = z.object({
  /** Voice is off until someone turns it on. */
  enabled: z.boolean().default(false),
  /** "ptt": click or Ctrl+Space only. "wake": also listen for the wake phrase, on this device. */
  activation: z.enum(['ptt', 'wake']).default('ptt'),
  wakePhrase: z.enum(WAKE_IDS).default('hey_qa_studio'),
  /** Wake-word score threshold: lower wakes more easily, higher gives fewer false starts. */
  sensitivity: z.number().min(0.3, 'At least 0.3.').max(0.8, 'At most 0.8.').default(0.5),
  idleTimeoutSec: z
    .number()
    .int()
    .min(5, 'At least 5 seconds.')
    .max(120, 'At most 120 seconds.')
    .default(20),
  pauseWhenHidden: z.boolean().default(true),
  sounds: z.boolean().default(true),
  /** LiveKit inference model that understands speech and drives the app. */
  model: z
    .string()
    .trim()
    .min(1, 'Enter a model name.')
    .max(100, 'The model name is too long.')
    .regex(/^[\w.\-:/]+$/, 'Use letters, numbers and . - _ : / only.')
    .default('google/gemini-2.5-flash'),
  coverage: z.enum(COVERAGE_LEVELS).default('standard'),
  format: z.enum(CASE_FORMATS).default('steps'),
  language: z
    .string()
    .trim()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Use a code like en or en-US.')
    .default('en'),
});
export type VoiceConfig = z.infer<typeof Config>;

/** What the settings page and the voice dock read. LiveKit keys are never part of it. */
export interface VoiceView extends VoiceConfig {
  /** True when the server has LiveKit credentials, so a session can start. */
  livekitConfigured: boolean;
  wakePhrases: { id: string; label: string }[];
  modelSuggestions: string[];
}

/** What the browser needs to join a voice session. */
export interface VoiceSession {
  url: string;
  room: string;
  /** The browser's identity in the room. The agent sends its commands to this participant. */
  identity: string;
  token: string;
  expiresAt: string;
}

/** Passed to the voice agent as job metadata. */
export interface VoiceAgentMetadata {
  userIdentity: string;
  model: string;
  language: string;
  coverage: VoiceConfig['coverage'];
  format: VoiceConfig['format'];
  idleTimeoutSec: number;
}

/**
 * Mints room tokens. LiveKit sits behind this port so the service is testable without a LiveKit server and the media
 * provider stays a swappable detail.
 */
export interface VoiceTransport {
  readonly url: string;
  createToken(room: string, identity: string, metadata: VoiceAgentMetadata): Promise<string>;
}

/** The LiveKit transport, or undefined when the server has no LiveKit credentials. */
export function liveKitTransport(
  env: Record<string, string | undefined>,
): VoiceTransport | undefined {
  const url = env['QA_LIVEKIT_URL']?.trim();
  const key = env['QA_LIVEKIT_API_KEY']?.trim();
  const secret = env['QA_LIVEKIT_API_SECRET']?.trim();
  if (!url || !key || !secret) return undefined;
  return {
    url,
    async createToken(room, identity, metadata) {
      const at = new AccessToken(key, secret, { identity, ttl: TOKEN_TTL_SECONDS });
      // One room, publish and subscribe only: a leaked token cannot list, create or close other rooms.
      at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true });
      // Dispatch the agent when this participant joins, so no separate API call (or room pre-creation) is needed.
      at.roomConfig = new RoomConfiguration({
        agents: [
          new RoomAgentDispatch({
            agentName: VOICE_AGENT_NAME,
            metadata: JSON.stringify(metadata),
          }),
        ],
      });
      return at.toJwt();
    },
  };
}

export interface VoiceStore {
  loadConfig(key: string): unknown;
  saveConfig(key: string, value: unknown): void;
}

export interface VoiceServiceDeps {
  store: VoiceStore;
  transport: VoiceTransport | undefined;
  audit(action: string, target: string, detail: string): void;
  now?: () => Date;
}

const SUGGESTIONS = ['google/gemini-2.5-flash', 'openai/gpt-4.1-mini', 'openai/gpt-4.1'];

/**
 * Voice control settings (Settings › Voice) and voice sessions. A session is a LiveKit room with the qa-studio agent;
 * the agent only turns speech into commands, which the browser carries out with the same code a mouse click runs.
 */
export class VoiceService {
  private config: VoiceConfig;

  constructor(private readonly d: VoiceServiceDeps) {
    const parsed = Config.safeParse(d.store.loadConfig('voice') ?? {});
    this.config = parsed.success ? parsed.data : Config.parse({});
  }

  view(): VoiceView {
    return {
      ...this.config,
      livekitConfigured: this.d.transport !== undefined,
      wakePhrases: WAKE_PHRASES.map((w) => ({ ...w })),
      modelSuggestions: SUGGESTIONS,
    };
  }

  update(patch: unknown): VoiceView {
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      throw new HttpError(
        400,
        'invalid-voice-settings',
        'Send the voice settings as a JSON object.',
      );
    }
    const parsed = Config.safeParse({ ...this.config, ...(patch as Record<string, unknown>) });
    if (!parsed.success) {
      const fields = Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join('.'), i.message]),
      );
      throw new HttpError(
        400,
        'invalid-voice-settings',
        'Some voice settings need fixing.',
        fields,
      );
    }
    const before = JSON.stringify(this.config);
    this.config = parsed.data;
    this.d.store.saveConfig('voice', parsed.data);
    if (JSON.stringify(parsed.data) !== before) {
      const c = parsed.data;
      this.d.audit(
        'voice.update',
        'voice',
        `${c.enabled ? 'On' : 'Off'}; ${c.activation === 'wake' ? `wake phrase ${c.wakePhrase}` : 'push to talk'}; model ${c.model}.`,
      );
    }
    return this.view();
  }

  /** Start a voice session: a fresh room, a token for this browser, and the agent dispatched with the settings. */
  async startSession(): Promise<VoiceSession> {
    if (!this.config.enabled) {
      throw new HttpError(
        409,
        'voice-off',
        'Voice control is off. Turn it on in Settings › Voice.',
      );
    }
    const transport = this.d.transport;
    if (!transport) {
      throw new HttpError(
        503,
        'voice-unconfigured',
        'Voice needs LiveKit. Set QA_LIVEKIT_URL, QA_LIVEKIT_API_KEY and QA_LIVEKIT_API_SECRET in Backend/Worker/.env and restart.',
      );
    }
    const id = crypto.randomUUID();
    const room = `qa-voice-${id}`;
    // The worker never learns who is signed in (the API strips cookies), so the identity is random per session.
    const identity = `qa-user-${id.slice(0, 8)}`;
    const c = this.config;
    const token = await transport.createToken(room, identity, {
      userIdentity: identity,
      model: c.model,
      language: c.language,
      coverage: c.coverage,
      format: c.format,
      idleTimeoutSec: c.idleTimeoutSec,
    });
    const now = this.d.now?.() ?? new Date();
    return {
      url: transport.url,
      room,
      identity,
      token,
      expiresAt: new Date(now.getTime() + TOKEN_TTL_SECONDS * 1000).toISOString(),
    };
  }
}
