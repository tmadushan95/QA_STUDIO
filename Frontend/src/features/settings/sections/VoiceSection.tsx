/**
 * Settings › Voice: one switch, how voice starts (push to talk or the wake phrase), and the generator defaults voice
 * uses. LiveKit keys live in the server's .env and are never shown here; this page only says whether they are set.
 * "Test wake phrase" runs the real detector on this device and shows its score against the chosen sensitivity.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Field,
  Panel,
  SaveBar,
  Select,
  TextInput,
  useToast,
} from '../../../design-system/index.js';
import { ApiError, errorMessage } from '../../../shared/api/http.js';
import { useResource } from '../../../shared/hooks/useAsync.js';
import {
  VOICE_SETTINGS_EVENT,
  fetchVoice,
  loadWakeListener,
  saveVoice,
  type VoiceSettings,
} from '../../voice/index.js';
import styles from './VoiceSection.module.css';

const TIMEOUTS = [10, 20, 30, 60];
const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'en-US', label: 'English (US)' },
  { id: 'en-GB', label: 'English (UK)' },
];

const pick = (d: VoiceSettings): VoiceSettings => ({
  enabled: d.enabled,
  activation: d.activation,
  wakePhrase: d.wakePhrase,
  sensitivity: d.sensitivity,
  idleTimeoutSec: d.idleTimeoutSec,
  pauseWhenHidden: d.pauseWhenHidden,
  sounds: d.sounds,
  model: d.model,
  coverage: d.coverage,
  format: d.format,
  language: d.language,
});

/** Settings › Voice. */
export function VoiceSection() {
  const toast = useToast();
  const res = useResource(fetchVoice);
  const [values, setValues] = useState<VoiceSettings>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (res.data) setValues(pick(res.data));
  }, [res.data]);

  if (res.error)
    return (
      <Alert tone="danger" title="Voice settings could not be loaded">
        {res.error}
      </Alert>
    );
  const d = res.data;
  if (!d || !values) return <Panel title="Voice">Loading…</Panel>;

  const set = (p: Partial<VoiceSettings>) => setValues({ ...values, ...p });
  const dirty = JSON.stringify(values) !== JSON.stringify(pick(d));
  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      res.set(await saveVoice(values));
      window.dispatchEvent(new Event(VOICE_SETTINGS_EVENT));
      toast.show('Voice settings saved.');
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields);
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };
  const off = !values.enabled;

  return (
    <>
      <Panel
        title="Voice control"
        description="Talk to QA Studio: open pages, fill forms, run test cases and generate new ones by voice. Anything you can click, voice can do, and it asks before anything that cannot be undone."
        actions={
          d.livekitConfigured ? (
            <Badge tone="success" glyph="●">
              LiveKit connected
            </Badge>
          ) : (
            <Badge tone="warning" glyph="!">
              LiveKit not set up
            </Badge>
          )
        }
      >
        <div className={styles.stack}>
          {!d.livekitConfigured && (
            <Alert tone="warning" title="Voice needs LiveKit on the server">
              Set <code>QA_LIVEKIT_URL</code>, <code>QA_LIVEKIT_API_KEY</code> and{' '}
              <code>QA_LIVEKIT_API_SECRET</code> in <code>Backend/Worker/.env</code>, then restart
              QA Studio. The keys stay on the server.
            </Alert>
          )}
          <Checkbox
            label="Turn on voice control"
            hint="Shows the voice button in the top bar. Ctrl+Space starts or ends a conversation."
            checked={values.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
        </div>
      </Panel>

      <Panel title="How voice starts">
        <fieldset className={styles.stack} disabled={off}>
          <legend className={styles.srOnly}>How voice starts</legend>
          <div className={styles.cards} role="radiogroup" aria-label="How voice starts">
            <ModeCard
              checked={values.activation === 'ptt'}
              onSelect={() => set({ activation: 'ptt' })}
              title="Push to talk"
              text="Click the voice button or press Ctrl+Space. The microphone is used only while you talk."
            />
            <ModeCard
              checked={values.activation === 'wake'}
              onSelect={() => set({ activation: 'wake' })}
              title="Wake phrase"
              text="Say the phrase to start, hands-free. It is detected on this computer; nothing is sent until it is heard."
            />
          </div>
          {values.activation === 'wake' && (
            <>
              <Field
                label="Wake phrase"
                hint="Each phrase is a trained model in Frontend/public/models."
                error={errors['wakePhrase']}
              >
                {(p) => (
                  <Select
                    {...p}
                    value={values.wakePhrase}
                    onChange={(e) => set({ wakePhrase: e.target.value })}
                  >
                    {d.wakePhrases.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <SensitivityField
                phrase={values.wakePhrase}
                value={values.sensitivity}
                error={errors['sensitivity']}
                onChange={(sensitivity) => set({ sensitivity })}
              />
              <Field
                label="End the conversation after silence"
                hint="Then voice goes back to waiting for the phrase."
                error={errors['idleTimeoutSec']}
              >
                {(p) => (
                  <Select
                    {...p}
                    value={String(values.idleTimeoutSec)}
                    onChange={(e) => set({ idleTimeoutSec: Number(e.target.value) })}
                  >
                    {[...new Set([...TIMEOUTS, values.idleTimeoutSec])]
                      .sort((a, b) => a - b)
                      .map((s) => (
                        <option key={s} value={s}>
                          {s} seconds
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
              <Checkbox
                label="Only listen while QA Studio is open in front"
                hint="Listening pauses when this tab is hidden or the computer is locked."
                checked={values.pauseWhenHidden}
                onChange={(e) => set({ pauseWhenHidden: e.target.checked })}
              />
            </>
          )}
          <Checkbox
            label="Play a short tone when voice starts and stops"
            checked={values.sounds}
            onChange={(e) => set({ sounds: e.target.checked })}
          />
        </fieldset>
      </Panel>

      <Panel
        title="Assistant and test-case generation"
        description="The defaults voice uses. You can change coverage or format in the conversation, for example “make it thorough”."
      >
        <fieldset className={styles.stack} disabled={off}>
          <legend className={styles.srOnly}>Assistant and test-case generation</legend>
          <Field
            label="Language model"
            hint={`Understands what you say and operates the app. Suggested: ${d.modelSuggestions.join(', ')}`}
            error={errors['model']}
          >
            {(p) => (
              <>
                <TextInput
                  {...p}
                  list="voice-models"
                  value={values.model}
                  onChange={(e) => set({ model: e.target.value })}
                />
                <datalist id="voice-models">
                  {d.modelSuggestions.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label="Coverage level" error={errors['coverage']}>
            {(p) => (
              <Select
                {...p}
                value={values.coverage}
                onChange={(e) => set({ coverage: e.target.value as VoiceSettings['coverage'] })}
              >
                <option value="smoke">Smoke: the main path only (1–3 cases)</option>
                <option value="standard">Standard: main flow plus key negative cases</option>
                <option value="thorough">Thorough: negative, boundary and permission cases</option>
              </Select>
            )}
          </Field>
          <Field label="Output format" error={errors['format']}>
            {(p) => (
              <Select
                {...p}
                value={values.format}
                onChange={(e) => set({ format: e.target.value as VoiceSettings['format'] })}
              >
                <option value="steps">Steps: “Click the Save button”</option>
                <option value="gherkin">Gherkin: “When I click the Save button”</option>
              </Select>
            )}
          </Field>
          <Field label="Spoken language" error={errors['language']}>
            {(p) => (
              <Select
                {...p}
                value={values.language}
                onChange={(e) => set({ language: e.target.value })}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Alert tone="info">
            Voice never saves on its own and asks before deleting or clearing anything. Passwords,
            keys and type-to-confirm boxes must be typed by you.
          </Alert>
        </fieldset>
      </Panel>

      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onDiscard={() => setValues(pick(d))}
        saveLabel="Save voice settings"
      />
    </>
  );
}

function ModeCard({
  checked,
  onSelect,
  title,
  text,
}: Readonly<{ checked: boolean; onSelect: () => void; title: string; text: string }>) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      className={checked ? `${styles.card} ${styles.cardOn}` : styles.card}
      onClick={onSelect}
    >
      <strong>{title}</strong>
      <span>{text}</span>
    </button>
  );
}

/** The sensitivity slider, with a live test that runs the real detector against it. */
function SensitivityField({
  phrase,
  value,
  error,
  onChange,
}: Readonly<{
  phrase: string;
  value: number;
  error: string | undefined;
  onChange: (v: number) => void;
}>) {
  const [score, setScore] = useState(0);
  const [peak, setPeak] = useState(0);
  const [testing, setTesting] = useState<'' | 'loading' | 'listening'>('');
  const [message, setMessage] = useState('Press Test, then say the phrase.');
  const stopRef = useRef<() => void>();
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => () => stopRef.current?.(), []);

  const test = async () => {
    stopRef.current?.();
    setTesting('loading');
    setPeak(0);
    setMessage('Loading the wake model…');
    const { startWakeListener } = await loadWakeListener();
    let best = 0;
    const listener = await startWakeListener(phrase, valueRef.current, {
      onReady: () => {
        setTesting('listening');
        setMessage('Listening… say the phrase now.');
      },
      onScore: (s) => {
        best = Math.max(best, s);
        setScore(s);
        setPeak(best);
      },
      onDetected: () => setMessage('Heard it. This sensitivity works for your voice and room.'),
      onProblem: (_kind, m) => {
        setTesting('');
        setMessage(m);
      },
    });
    if (!listener) return;
    const timer = setTimeout(() => {
      stop();
      setMessage((m) =>
        m.startsWith('Heard')
          ? m
          : best > 0
            ? `Not heard. The best score was ${best.toFixed(2)}; try a setting below that.`
            : 'Nothing like the phrase was heard. Check the microphone and try again.',
      );
    }, 8000);
    const stop = () => {
      clearTimeout(timer);
      listener.stop();
      setTesting('');
      setScore(0);
      stopRef.current = undefined;
    };
    stopRef.current = stop;
  };

  return (
    <Field
      label="Sensitivity"
      hint="Lower wakes more easily; higher gives fewer false starts. Raise it if voice starts by itself."
      error={error}
    >
      {(p) => (
        <div className={styles.meter}>
          <div className={styles.track} aria-hidden="true">
            <div
              className={score >= value ? `${styles.fill} ${styles.hit}` : styles.fill}
              style={{ width: `${Math.round(score * 100)}%` }}
            />
            {peak > 0 && <div className={styles.peak} style={{ left: `${peak * 100}%` }} />}
            <div className={styles.threshold} style={{ left: `${value * 100}%` }}>
              <span>{value.toFixed(2)}</span>
            </div>
          </div>
          <input
            {...p}
            type="range"
            min={0.3}
            max={0.8}
            step={0.05}
            value={value}
            className={styles.range}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <div className={styles.scale}>
            <span>Wakes more easily</span>
            <span>Fewer false starts</span>
          </div>
          <div className={styles.testRow}>
            <Button
              size="sm"
              icon="mic"
              loading={testing === 'loading'}
              onClick={() => (testing ? stopRef.current?.() : void test())}
            >
              {testing === 'listening' ? 'Stop test' : 'Test wake phrase'}
            </Button>
            <span className={styles.testMsg} role="status" aria-live="polite">
              {message}
            </span>
          </div>
        </div>
      )}
    </Field>
  );
}
