/**
 * Voice in the shell: a pill in the top bar that always says whether QA Studio can hear you (and how to start), a
 * one-time coach mark, and a dock at the bottom of the screen during a session showing what the assistant heard,
 * said and did.
 *
 * Everything here is marked `data-voice-ui`, so voice commands never target the voice controls themselves.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../design-system/index.js';
import { href } from '../../shared/hooks/useRoute.js';
import type { AgentState } from './session.js';
import { useVoice, type VoiceController } from './useVoice.js';
import styles from './VoiceControl.module.css';

const COACH_KEY = 'qa-voice-coach-seen';

const STATUS: Record<AgentState, string> = {
  connecting: 'Connecting…',
  initializing: 'Getting ready…',
  listening: 'Listening',
  thinking: 'Working on it',
  speaking: 'Speaking',
};

const HINTS = [
  '“Open Test Execution”',
  '“Generate cases for password reset”',
  '“Run the selected cases”',
  '“Change the timeout to 30 seconds”',
];

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeFlag(key: string): void {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    // Storage blocked: the coach mark simply shows again next time.
  }
}

/** The top-bar voice pill plus the session dock. Renders nothing while voice is off. */
export function VoiceControl() {
  const voice = useVoice();
  const [coach, setCoach] = useState(false);
  const wakeName =
    voice.settings?.wakePhrases.find((w) => w.id === voice.settings?.wakePhrase)?.label ??
    'Hey QA Studio';

  useEffect(() => {
    if (voice.phase === 'standby' && voice.wakeListening && !readFlag(COACH_KEY)) setCoach(true);
  }, [voice.phase, voice.wakeListening]);
  const closeCoach = () => {
    writeFlag(COACH_KEY);
    setCoach(false);
  };

  if (voice.phase === 'hidden') return null;
  return (
    <span className={styles.anchor} data-voice-ui>
      <Pill voice={voice} wakeName={wakeName} />
      {coach && (
        <div className={styles.coach} role="dialog" aria-label="Voice wake is on">
          <strong>Voice wake is on</strong>
          <p>
            Say <b>“{wakeName}”</b> to start. Your microphone is checked on this computer only;
            audio leaves the browser only after the phrase is heard.
          </p>
          <div className={styles.coachRow}>
            <span>
              Or press <kbd>Ctrl</kbd> <kbd>Space</kbd>
            </span>
            <button type="button" onClick={closeCoach}>
              Got it
            </button>
          </div>
        </div>
      )}
      {voice.error && voice.phase === 'standby' && (
        <div className={`${styles.coach} ${styles.notice}`} role="alert">
          <strong>Voice could not start</strong>
          <p>{voice.error}</p>
          <div className={styles.coachRow}>
            <span />
            <button type="button" onClick={voice.dismissError}>
              OK
            </button>
          </div>
        </div>
      )}
      {(voice.phase === 'live' || voice.phase === 'connecting') &&
        createPortal(<Dock voice={voice} />, document.body)}
    </span>
  );
}

function Pill({ voice, wakeName }: Readonly<{ voice: VoiceController; wakeName: string }>) {
  if (voice.phase === 'unconfigured') {
    return (
      <a className={`${styles.pill} ${styles.warn}`} href={href('settings', 'voice')}>
        <Icon name="mic-off" size={16} />
        <span className={styles.long}>Voice needs setup</span>
      </a>
    );
  }
  if (voice.phase === 'live' || voice.phase === 'connecting') {
    return (
      <span className={`${styles.pill} ${styles.live}`} role="status">
        <span className={styles.bars} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span>{voice.phase === 'connecting' ? 'Connecting…' : 'Voice on'}</span>
        <button
          type="button"
          className={styles.x}
          aria-label="End voice session"
          onClick={voice.end}
        >
          <Icon name="close" size={12} />
        </button>
      </span>
    );
  }
  const problem = voice.wakeProblem;
  if (problem && voice.settings?.activation === 'wake') {
    return (
      <button
        type="button"
        className={`${styles.pill} ${styles.err}`}
        title={problem.message}
        onClick={voice.start}
      >
        <Icon name="mic-off" size={16} />
        <span className={styles.long}>
          {problem.kind === 'mic-blocked'
            ? 'Microphone blocked'
            : problem.kind === 'model-missing'
              ? 'Wake model not installed'
              : 'Wake phrase unavailable'}
        </span>
        <kbd className={styles.long}>Ctrl Space</kbd>
      </button>
    );
  }
  return (
    <button
      type="button"
      className={styles.pill}
      onClick={voice.start}
      aria-label={voice.wakeListening ? `Start voice. Or say ${wakeName}.` : 'Start voice'}
      title={voice.error || undefined}
    >
      {voice.wakeListening ? (
        <>
          <span className={styles.dot} aria-hidden="true" />
          <span>
            <span className={styles.long}>Say </span>
            <span className={styles.phrase}>“{wakeName}”</span>
          </span>
        </>
      ) : (
        <>
          <Icon name="mic" size={16} />
          <span className={styles.long}>Voice</span>
        </>
      )}
      <kbd className={styles.long}>Ctrl Space</kbd>
    </button>
  );
}

function Dock({ voice }: Readonly<{ voice: VoiceController }>) {
  const state: AgentState = voice.phase === 'connecting' ? 'connecting' : voice.agentState;
  const lines = voice.transcript;
  return (
    <section className={styles.dock} data-voice-ui aria-label="Voice assistant">
      {/* Header: who is talking and a quiet way to close; the conversation below uses the card's full width. */}
      <div className={styles.dockHead}>
        <div className={styles.orb} data-mode={state} aria-hidden="true">
          <Icon name="mic" size={16} />
        </div>
        <div className={styles.status} data-mode={state} role="status" aria-live="polite">
          <span className={styles.stateChip}>
            <span className={styles.stateDot} aria-hidden="true" />
            {STATUS[state]}
          </span>
          {voice.activity && state !== 'connecting' && (
            <span className={styles.activity}>{voice.activity}</span>
          )}
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={voice.end}
          aria-label="End voice session"
          aria-keyshortcuts="Control+Space Escape"
          title="End voice session (Ctrl+Space)"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className={styles.say}>
        {lines.length === 0 ? (
          <span className={styles.interim}>
            {state === 'connecting' ? 'Joining the assistant…' : 'Go ahead, I’m listening.'}
          </span>
        ) : (
          // Only the latest exchange: the card stays small enough not to sit on the page, and the top-bar pill and
          // the assistant's actions on screen carry the rest.
          lines.slice(-2).map((l) => (
            <p
              key={l.id}
              className={l.final ? styles.line : `${styles.line} ${styles.interim}`}
              data-who={l.who}
            >
              <span className={styles.who}>{l.who === 'you' ? 'You' : 'QA Studio'}</span>
              <span className={styles.text}>{l.text}</span>
            </p>
          ))
        )}
      </div>
      {lines.length === 0 && state !== 'connecting' && (
        <div className={styles.hints}>
          {HINTS.slice(0, 2).map((h) => (
            <span key={h} className={styles.hint}>
              {h}
            </span>
          ))}
        </div>
      )}
      <p className={styles.footnote} aria-hidden="true">
        <kbd>Ctrl</kbd> + <kbd>Space</kbd> to end
      </p>
      {voice.error && (
        <p className={styles.error} role="alert">
          {voice.error}
        </p>
      )}
    </section>
  );
}
