/**
 * Common parameters: values set once for a project and used by every one of its test cases that has no value of its
 * own (for example the project code or a default role). Each row shows how many cases read the name and how many
 * override it with their own value, so the effect of a change is visible before saving.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Panel,
  SaveBar,
  TextInput,
  useToast,
} from '../../design-system/index.js';
import { ApiError, errorMessage } from '../../shared/api/http.js';
import { useResource } from '../../shared/hooks/useAsync.js';
import { plural } from '../../shared/lib/format.js';
import {
  fetchCommonParameters,
  saveCommonParameters,
  suggestCommonParameters,
  type CommonParameterItem,
} from '../test-cases/api.js';
import styles from '../test-cases/components/Parameters.module.css';
import { fetchProjects } from './api.js';
import { useProjectScope } from './ProjectScope.js';

/** Project settings › Parameters. */
export function CommonParametersSection() {
  const toast = useToast();
  const projects = useResource(fetchProjects);
  const projectId = useProjectScope().project?.id ?? 0;
  const common = useResource(
    () => (projectId ? fetchCommonParameters(projectId) : Promise.resolve(undefined)),
    [projectId],
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'fill'>('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const items: CommonParameterItem[] = common.data?.items ?? [];
  const baseline = Object.fromEntries(items.map((i) => [i.name, i.value]));
  useEffect(() => setValues(baseline), [common.data]);
  const names = [...new Set([...items.map((i) => i.name), ...Object.keys(values)])];
  const dirty = names.some((n) => (values[n] ?? '').trim() !== (baseline[n] ?? ''));
  const byName = new Map(items.map((i) => [i.name, i]));

  const save = async () => {
    setBusy('save');
    setErrors({});
    try {
      const r = await saveCommonParameters(projectId, values);
      common.set(r);
      toast.show(
        'Common parameters saved. Cases without their own value use them from the next run.',
      );
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields);
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setBusy('');
    }
  };

  const fill = async () => {
    setBusy('fill');
    try {
      const s = await suggestCommonParameters(projectId);
      if (s.length === 0) toast.show('Nothing to fill.', { tone: 'info' });
      else {
        setValues((v) => ({ ...v, ...Object.fromEntries(s.map((x) => [x.name, x.value])) }));
        toast.show(`Filled ${plural(s.length, 'value')}. Check them, then save.`, { tone: 'info' });
      }
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setBusy('');
    }
  };

  const addName = () => {
    const n = newName.trim();
    if (!/^[A-Za-z][\w-]{0,99}$/.test(n) || n in values) return;
    setValues({ ...values, [n]: '' });
    setNewName('');
  };

  const emptyUsed = items.filter(
    (i) => i.usedBy > i.overriddenBy && !(values[i.name] ?? '').trim(),
  ).length;

  return (
    <>
      <Panel
        title="Common parameters"
        description="Values shared by every test case of this project. A case uses its own value when it sets one, and this value otherwise."
        actions={
          <>
            <Button
              icon="sparkle"
              loading={busy === 'fill'}
              disabled={!projectId || emptyUsed === 0}
              onClick={() => void fill()}
            >
              Auto-fill empty
            </Button>
          </>
        }
      >
        {(projects.error || common.error) && (
          <Alert tone="danger">{projects.error ?? common.error}</Alert>
        )}
        {!projectId ? (
          <EmptyState icon="folder" title="No project yet">
            Add a project first.
          </EmptyState>
        ) : (
          <div className={styles.panel}>
            {names.length === 0 && (
              <EmptyState icon="sliders" title="No parameters in this project yet">
                Names appear here as soon as a test case’s steps read them as{' '}
                <code>{'{{data.name}}'}</code>. You can also add one below.
              </EmptyState>
            )}
            <div className={styles.grid}>
              {names.map((name) => {
                const info = byName.get(name);
                const value = values[name] ?? '';
                const unused = !info || info.usedBy === 0;
                const needed =
                  info !== undefined && info.usedBy > info.overriddenBy && !value.trim();
                return (
                  <div
                    key={name}
                    className={needed ? `${styles.row} ${styles.rowMissing}` : styles.row}
                  >
                    <div className={styles.name}>
                      <label htmlFor={`common-${name}`}>
                        <code>{name}</code>
                      </label>
                      {unused ? (
                        <Badge tone="neutral">Not used yet</Badge>
                      ) : (
                        <span className={styles.counts}>
                          {plural(info.usedBy, 'case')} use it
                          {info.overriddenBy > 0
                            ? ` · ${info.overriddenBy} with their own value`
                            : ''}
                        </span>
                      )}
                    </div>
                    <TextInput
                      id={`common-${name}`}
                      value={value}
                      invalid={needed || !!errors[`values.${name}`]}
                      title={errors[`values.${name}`]}
                      maxLength={500}
                      placeholder={
                        needed
                          ? 'Missing for cases without their own value'
                          : 'Leave empty for none'
                      }
                      onChange={(e) => setValues({ ...values, [name]: e.target.value })}
                    />
                  </div>
                );
              })}
            </div>
            <form
              className={styles.head}
              onSubmit={(e) => {
                e.preventDefault();
                addName();
              }}
            >
              <TextInput
                aria-label="New parameter name"
                placeholder="New parameter name, such as projectCode"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Button
                type="submit"
                icon="plus"
                disabled={!/^[A-Za-z][\w-]{0,99}$/.test(newName.trim())}
              >
                Add parameter
              </Button>
            </form>
          </div>
        )}
      </Panel>
      <SaveBar
        dirty={dirty}
        saving={busy === 'save'}
        onSave={() => void save()}
        onDiscard={() => setValues(baseline)}
        saveLabel="Save common parameters"
      />
    </>
  );
}
