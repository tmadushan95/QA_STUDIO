/**
 * The settings section that edits what applies to every project: Execution (browser, speed, timeouts). Where a
 * project runs and how it signs in are set on the project (Projects & Versions › Projects).
 */
import { Checkbox, Field, Select, TextInput } from '../../../design-system/index.js';
import { SettingsForm } from './SettingsForm.js';

/** Settings › Execution: browser, speed and workers. */
export function ExecutionSection() {
  return (
    <SettingsForm
      title="Execution"
      description="How tests run: browser, how many at once, and how long to wait."
    >
      {({ values, set, errors }) => (
        <>
          <Field label="Browser" error={errors['browser']}>
            {(p) => (
              <Select
                {...p}
                value={values.browser}
                onChange={(e) => set({ browser: e.target.value as typeof values.browser })}
              >
                <option value="chromium">Chromium (Chrome, Edge)</option>
                <option value="firefox">Firefox</option>
                <option value="webkit">WebKit (Safari)</option>
              </Select>
            )}
          </Field>
          <Checkbox
            label="Run without showing the browser window"
            hint="Faster. Turn off to watch tests as they run."
            checked={values.headless}
            onChange={(e) => set({ headless: e.target.checked })}
          />
          <Field
            label="Browsers at once"
            error={errors['workers']}
            hint="The default for new runs."
          >
            {(p) => (
              <TextInput
                {...p}
                type="number"
                min={1}
                max={16}
                value={values.workers}
                onChange={(e) => set({ workers: Number(e.target.value) })}
              />
            )}
          </Field>
          <Field
            label="Step time limit (ms)"
            error={errors['timeoutMs']}
            hint="How long a step may wait for the page."
          >
            {(p) => (
              <TextInput
                {...p}
                type="number"
                min={1000}
                value={values.timeoutMs}
                onChange={(e) => set({ timeoutMs: Number(e.target.value) })}
              />
            )}
          </Field>
          <Field
            label="Slow down each action (ms)"
            error={errors['slowMoMs']}
            hint="0 for full speed; a few hundred to follow along."
          >
            {(p) => (
              <TextInput
                {...p}
                type="number"
                min={0}
                value={values.slowMoMs}
                onChange={(e) => set({ slowMoMs: Number(e.target.value) })}
              />
            )}
          </Field>
        </>
      )}
    </SettingsForm>
  );
}
