import { z } from 'zod';
import type { VoiceJobMetadata } from '@qa-studio/shared';

/** Must match VOICE_AGENT_NAME in qa-api, which dispatches the agent by this name. */
export const AGENT_NAME = 'qa-studio';

/** How long the agent waits for the browser to answer a command. Generating cases can take a while. */
export const COMMAND_TIMEOUT_MS = 90_000;

/**
 * Worker settings from Backend/Worker/.env. The LiveKit Agents CLI reads LIVEKIT_URL, LIVEKIT_API_KEY and
 * LIVEKIT_API_SECRET; QA Studio names them QA_LIVEKIT_* like its other settings, so they are copied across here.
 */
export function applyLiveKitEnv(env: NodeJS.ProcessEnv): { configured: boolean } {
  const pairs: [string, string][] = [
    ['LIVEKIT_URL', 'QA_LIVEKIT_URL'],
    ['LIVEKIT_API_KEY', 'QA_LIVEKIT_API_KEY'],
    ['LIVEKIT_API_SECRET', 'QA_LIVEKIT_API_SECRET'],
  ];
  for (const [target, source] of pairs) {
    const value = env[source]?.trim();
    if (!env[target] && value) env[target] = value;
  }
  return { configured: pairs.every(([target]) => Boolean(env[target])) };
}

/** Speech models. Speech recognition and voice are not language models, so they are set here, not in the UI. */
export function speechModels(env: NodeJS.ProcessEnv): { stt: string; tts: string } {
  return {
    stt: env['QA_VOICE_STT_MODEL']?.trim() || 'deepgram/nova-3',
    tts: env['QA_VOICE_TTS_MODEL']?.trim() || 'cartesia/sonic-2',
  };
}

const Metadata = z.object({
  userIdentity: z.string().min(1),
  model: z.string().min(1).default('google/gemini-2.5-flash'),
  language: z.string().default('en'),
  coverage: z.enum(['smoke', 'standard', 'thorough']).default('standard'),
  format: z.enum(['steps', 'gherkin']).default('steps'),
  idleTimeoutSec: z.number().int().min(5).max(120).default(20),
});

/** Read the job metadata the API attached. Throws when it is missing, because the agent cannot reach the browser without it. */
export function parseMetadata(raw: string | undefined): VoiceJobMetadata {
  let json: unknown;
  try {
    json = JSON.parse(raw ?? '');
  } catch {
    throw new Error(
      'The voice job has no metadata. Start voice from QA Studio, not from LiveKit directly.',
    );
  }
  return Metadata.parse(json);
}
