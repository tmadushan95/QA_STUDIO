/**
 * The voice controller: one per app. It loads the settings, listens for the wake phrase when that is on, starts and
 * ends LiveKit sessions, and exposes what the pill and the dock show. Ctrl+Space starts or ends a session from
 * anywhere; Escape ends one when no popup is open.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../shared/api/http.js';
import { fetchVoice, startVoiceSession, type VoiceData } from './api.js';
import { playTone } from './sounds.js';
import type { AgentState, LiveSession, TranscriptLine } from './session.js';
import type { WakeListener, WakeProblem } from './wakeword/listener.js';

/** Fired by Settings › Voice after a save, so the controller picks up the change without a reload. */
export const VOICE_SETTINGS_EVENT = 'qa-voice-settings';

/** Where voice is in its life cycle. */
export type VoicePhase =
  /** Voice is off, or the worker has no voice support: nothing is shown. */
  | 'hidden'
  /** Turned on but LiveKit is not set up on the server. */
  | 'unconfigured'
  /** Waiting: for Ctrl+Space or a click, and for the wake phrase when that is on. */
  | 'standby'
  | 'connecting'
  | 'live';

/** What the voice UI reads and can do. */
export interface VoiceController {
  phase: VoicePhase;
  settings: VoiceData | undefined;
  /** True while the wake phrase is being listened for on this device. */
  wakeListening: boolean;
  wakeProblem: { kind: WakeProblem; message: string } | undefined;
  agentState: AgentState;
  transcript: TranscriptLine[];
  activity: string;
  error: string;
  start(): void;
  end(): void;
  dismissError(): void;
}

const MAX_LINES = 4;

/** Runs voice for the whole app. Call once, in the shell. */
export function useVoice(): VoiceController {
  const [settings, setSettings] = useState<VoiceData>();
  const [phase, setPhase] = useState<VoicePhase>('hidden');
  const [agentState, setAgentState] = useState<AgentState>('connecting');
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [activity, setActivity] = useState('');
  const [error, setError] = useState('');
  const [wakeListening, setWakeListening] = useState(false);
  const [wakeProblem, setWakeProblem] = useState<VoiceController['wakeProblem']>();
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const session = useRef<LiveSession>();
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Settings: on load and whenever Settings › Voice saves.
  useEffect(() => {
    const load = () =>
      fetchVoice().then(
        (v) => {
          setSettings(v);
          setPhase((p) =>
            p === 'live' || p === 'connecting'
              ? p
              : !v.enabled
                ? 'hidden'
                : v.livekitConfigured
                  ? 'standby'
                  : 'unconfigured',
          );
        },
        // An older worker without voice routes: voice simply does not appear.
        () => setPhase((p) => (p === 'live' ? p : 'hidden')),
      );
    load();
    window.addEventListener(VOICE_SETTINGS_EVENT, load);
    return () => window.removeEventListener(VOICE_SETTINGS_EVENT, load);
  }, []);

  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const end = useCallback(() => {
    void session.current?.close();
  }, []);

  const start = useCallback(() => {
    if (phaseRef.current !== 'standby' || !settings) return;
    setPhase('connecting');
    setError('');
    setTranscript([]);
    setActivity('');
    if (settings.sounds) playTone('start');
    void (async () => {
      try {
        const grant = await startVoiceSession();
        const { openSession } = await import('./session.js');
        session.current = await openSession(grant, {
          onAgentState: setAgentState,
          onTranscript: (line) =>
            setTranscript((lines) => {
              const rest = lines.filter((l) => l.id !== line.id);
              return [...rest, line].slice(-MAX_LINES);
            }),
          onActivity: setActivity,
          onEnd: () => void session.current?.close(),
          onClosed: () => {
            session.current = undefined;
            if (settings.sounds) playTone('stop');
            setPhase('standby');
          },
        });
        setPhase('live');
      } catch (e) {
        session.current = undefined;
        const name = e instanceof Error ? e.name : '';
        setError(
          name === 'NotAllowedError'
            ? 'The microphone is blocked. Allow it for this site in the browser’s site settings, then try again.'
            : errorMessage(e),
        );
        setPhase('standby');
      }
    })();
  }, [settings]);

  // Wake phrase: listen only while waiting, visible (unless told otherwise) and set to wake mode.
  const wakeWanted =
    phase === 'standby' &&
    settings?.activation === 'wake' &&
    (visible || settings.pauseWhenHidden === false) &&
    wakeProblem?.kind !== 'mic-blocked' &&
    wakeProblem?.kind !== 'model-missing' &&
    wakeProblem?.kind !== 'unsupported';
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    if (!wakeWanted || !settings) return;
    let listener: WakeListener | undefined;
    let cancelled = false;
    void import('./wakeword/listener.js').then(({ startWakeListener }) =>
      startWakeListener(settings.wakePhrase, settings.sensitivity, {
        onReady: () => {
          setWakeListening(true);
          setWakeProblem(undefined);
        },
        onDetected: () => startRef.current(),
        onProblem: (kind, message) => {
          setWakeListening(false);
          setWakeProblem({ kind, message });
        },
      }).then((l) => {
        if (cancelled) l?.stop();
        else listener = l;
      }),
    );
    return () => {
      cancelled = true;
      listener?.stop();
      setWakeListening(false);
    };
  }, [wakeWanted, settings?.wakePhrase, settings?.sensitivity]);

  // Keyboard: Ctrl+Space toggles a session; Escape ends one unless a popup is open (Escape closes the popup then).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        if (phaseRef.current === 'standby') {
          e.preventDefault();
          startRef.current();
        } else if (phaseRef.current === 'live') {
          e.preventDefault();
          end();
        }
      } else if (
        e.key === 'Escape' &&
        phaseRef.current === 'live' &&
        !document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
        end();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [end]);

  // Leaving the app closes the session cleanly.
  useEffect(() => () => void session.current?.close(), []);

  return {
    phase,
    settings,
    wakeListening,
    wakeProblem,
    agentState,
    transcript,
    activity,
    error,
    start,
    end,
    dismissError: () => setError(''),
  };
}
