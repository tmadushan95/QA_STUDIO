/**
 * SettingsForm: used by the Execution section. It loads the settings record, shows the section's fields, shows field
 * errors from the server, and saves from a sticky save bar.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Panel, SaveBar, useToast } from '../../../design-system/index.js';
import { ApiError, errorMessage } from '../../../shared/api/http.js';
import { useResource } from '../../../shared/hooks/useAsync.js';
import { fetchSettings, saveSettings, type SettingsData, type SettingsValues } from '../api.js';

/** Props of `SettingsForm`. */
export interface SettingsFormProps {
  title: string;
  description: string;
  children: (ctx: {
    values: SettingsValues;
    set: (patch: Partial<SettingsValues>) => void;
    errors: Record<string, string>;
    data: SettingsData;
  }) => ReactNode;
}

/** Loads the settings and saves only the fields its section changed. */
export function SettingsForm({ title, description, children }: SettingsFormProps) {
  const toast = useToast();
  const res = useResource(fetchSettings);
  const [values, setValues] = useState<SettingsValues>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (res.data) setValues(res.data.values);
  }, [res.data]);

  if (res.error)
    return (
      <Alert tone="danger" title="Settings could not be loaded">
        {res.error}
      </Alert>
    );
  if (!res.data || !values) return <Panel title={title}>Loading…</Panel>;

  const dirty = JSON.stringify(values) !== JSON.stringify(res.data.values);
  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      res.set(await saveSettings(values));
      toast.show('Settings saved. They apply to the next run.');
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields);
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Panel title={title} description={description}>
        <div style={{ display: 'grid', gap: 'var(--space-5)', maxWidth: '40rem' }}>
          {children({
            values,
            set: (p) => setValues({ ...values, ...p }),
            errors,
            data: res.data,
          })}
        </div>
      </Panel>
      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onDiscard={() => setValues(res.data!.values)}
        saveLabel="Save settings"
      />
    </>
  );
}
