/**
 * Requests of the voice feature: its settings (Settings › Voice) and starting a session. LiveKit keys never reach the
 * browser; a session hands over a short-lived token for one room.
 */
import { get, send } from '../../shared/api/http.js';

/** How voice starts: push to talk only, or also on the wake phrase. */
export type VoiceActivation = 'ptt' | 'wake';
/** How widely generated cases cover a description. */
export type VoiceCoverage = 'smoke' | 'standard' | 'thorough';
/** How generated steps are phrased. */
export type VoiceFormat = 'steps' | 'gherkin';

/** The settings people can change. */
export interface VoiceSettings {
  enabled: boolean;
  activation: VoiceActivation;
  wakePhrase: string;
  sensitivity: number;
  idleTimeoutSec: number;
  pauseWhenHidden: boolean;
  sounds: boolean;
  model: string;
  coverage: VoiceCoverage;
  format: VoiceFormat;
  language: string;
}

/** Settings plus what the server can offer. */
export interface VoiceData extends VoiceSettings {
  /** False until the server has LiveKit credentials. */
  livekitConfigured: boolean;
  wakePhrases: { id: string; label: string }[];
  modelSuggestions: string[];
}

/** What the browser needs to join a voice session. */
export interface VoiceSessionGrant {
  url: string;
  room: string;
  identity: string;
  token: string;
  expiresAt: string;
}

/** Read the voice settings. */
export const fetchVoice = () => get<VoiceData>('/api/voice');

/** Save some or all voice settings; answers with all of them. */
export const saveVoice = (patch: Partial<VoiceSettings>) =>
  send<VoiceData>('/api/voice', patch, 'PUT');

/** Start a voice session: a fresh room with the agent, and a token for this browser. */
export const startVoiceSession = () => send<VoiceSessionGrant>('/api/voice/session');
