/**
 * Public surface of the voice feature. Other features offer actions with `useVoiceAction`; the shell renders
 * `VoiceControl`; Settings › Voice reads and saves the settings.
 */
export {
  useVoiceAction,
  registerVoiceAction,
  type VoiceAction,
  type VoiceActionResult,
} from './registry.js';
export {
  fetchVoice,
  saveVoice,
  type VoiceActivation,
  type VoiceCoverage,
  type VoiceData,
  type VoiceFormat,
  type VoiceSettings,
} from './api.js';
export { VOICE_SETTINGS_EVENT } from './useVoice.js';

/** Loads the wake-phrase listener on demand (ONNX Runtime is large), for the sensitivity test in Settings. */
export const loadWakeListener = () => import('./wakeword/listener.js');
