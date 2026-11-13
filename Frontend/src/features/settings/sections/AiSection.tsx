/**
 * AI section: which provider drafts steps and explains failures, its model and key, and spending limits.
 * Keys are write-only: once saved they are never shown again, and test-account passwords are never sent to a model.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Field,
  Panel,
  Select,
  TextInput,
  useToast,
} from '../../../design-system/index.js';
import { errorMessage } from '../../../shared/api/http.js';
import { useResource } from '../../../shared/hooks/useAsync.js';
import {
  fetchAi,
  removeAiKey,
  saveAi,
  saveAiKey,
  testAi,
  type AiData,
  type AiProvider,
} from '../api.js';

const NAMES: Record<AiProvider, string> = {
  anthropic: 'Anthropic Claude',
  gemini: 'Google Gemini',
};

/** Settings › AI: provider, model, keys and limits. */
export function AiSection() {
  const toast = useToast();
  const res = useResource(fetchAi);
  const [busy, setBusy] = useState('');
  const act = async (id: string, fn: () => Promise<AiData | string>) => {
    setBusy(id);
    try {
      const r = await fn();
      if (typeof r === 'string') toast.show(r);
      else {
        res.set(r);
        toast.show('AI settings saved.');
      }
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setBusy('');
    }
  };
  const d = res.data;
  if (res.error) return <Alert tone="danger">{res.error}</Alert>;
  if (!d) return <Panel title="AI">Loading…</Panel>;
  return (
    <>
      <Panel
        title="AI provider"
        description="AI drafts steps, proposes test cases and explains failures. A person approves everything it writes."
      >
        <div style={{ display: 'grid', gap: 'var(--space-4)', maxWidth: '40rem' }}>
          {d.ready ? (
            <Alert tone="success">
              AI is ready ({NAMES[d.provider as AiProvider] ?? d.provider}).
            </Alert>
          ) : (
            <Alert tone="warning">{d.reason ?? 'AI is switched off.'}</Alert>
          )}
          <Field label="Provider">
            {(p) => (
              <Select
                {...p}
                value={d.provider}
                onChange={(e) =>
                  void act('provider', () =>
                    saveAi({ provider: e.target.value as AiData['provider'] }),
                  )
                }
              >
                <option value="none">Off</option>
                <option value="anthropic">{NAMES.anthropic}</option>
                <option value="gemini">{NAMES.gemini}</option>
              </Select>
            )}
          </Field>
          {d.provider !== 'none' && (
            <Button
              loading={busy === 'test'}
              onClick={() =>
                void act('test', async () => {
                  const r = await testAi(d.provider as AiProvider);
                  if (!r.ok) throw new Error(r.message);
                  return `${r.message} (${r.ms} ms)`;
                })
              }
            >
              Test connection
            </Button>
          )}
        </div>
      </Panel>
      {(['anthropic', 'gemini'] as const).map((p) => (
        <ProviderPanel key={p} provider={p} data={d} busy={busy} act={act} />
      ))}
    </>
  );
}

function ProviderPanel({
  provider,
  data,
  busy,
  act,
}: {
  provider: AiProvider;
  data: AiData;
  busy: string;
  act: (id: string, fn: () => Promise<AiData | string>) => Promise<void>;
}) {
  const v = data[provider];
  const [model, setModel] = useState(v.model);
  const [key, setKey] = useState('');
  useEffect(() => setModel(v.model), [v.model]);
  return (
    <Panel
      title={NAMES[provider]}
      actions={
        v.hasKey ? (
          <Badge tone="success" glyph="✓">
            {v.keySource === 'environment' ? 'Key from environment' : 'Key saved'}
          </Badge>
        ) : (
          <Badge tone="neutral">No key</Badge>
        )
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-4)', maxWidth: '40rem' }}>
        <Field
          label="Model"
          hint={v.suggestions.length ? `Suggested: ${v.suggestions.join(', ')}` : undefined}
        >
          {(p) => (
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <TextInput
                {...p}
                list={`${provider}-models`}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
              <datalist id={`${provider}-models`}>
                {v.suggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <Button
                disabled={model === v.model}
                loading={busy === `${provider}-model`}
                onClick={() =>
                  void act(`${provider}-model`, () => saveAi({ [provider]: { model } }))
                }
              >
                Save
              </Button>
            </div>
          )}
        </Field>
        <Field
          label={v.hasKey ? 'Replace API key' : 'API key'}
          hint="Stored encrypted. It is never shown again."
        >
          {(p) => (
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <TextInput
                {...p}
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <Button
                variant="primary"
                disabled={!key.trim()}
                loading={busy === `${provider}-key`}
                onClick={() =>
                  void act(`${provider}-key`, async () => {
                    const r = await saveAiKey(provider, key.trim());
                    setKey('');
                    return r;
                  })
                }
              >
                Save key
              </Button>
            </div>
          )}
        </Field>
        {v.hasKey && v.keySource === 'app' && (
          <div>
            <Button
              variant="ghost"
              icon="trash"
              loading={busy === `${provider}-remove`}
              onClick={() => void act(`${provider}-remove`, () => removeAiKey(provider))}
            >
              Remove key
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}
