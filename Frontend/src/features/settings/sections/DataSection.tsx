/**
 * Data & storage section: where data is kept, "Clear all data" (test cases with their steps and TC files, and the
 * parameters; run history only if ticked), and the backups taken before each clear, which can be restored for 7 days.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Panel,
  useToast,
} from '../../../design-system/index.js';
import { errorMessage } from '../../../shared/api/http.js';
import { useResource } from '../../../shared/hooks/useAsync.js';
import { formatDate, plural } from '../../../shared/lib/format.js';
import { clearAll, fetchBackups, fetchSettings, restoreBackup } from '../api.js';

const CONFIRM_WORD = 'CLEAR';

/** Settings › Data & storage: where data is kept, clearing it, and backups. */
export function DataSection() {
  const toast = useToast();
  const settings = useResource(fetchSettings);
  const backups = useResource(fetchBackups);
  const [opts, setOpts] = useState({ scenarios: true, parameters: true, runs: false });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const restore = async (id: string) => {
    try {
      const b = await restoreBackup(id);
      toast.show(
        `Restored ${plural(b.cases, 'test case')} and ${plural(b.scenarios, 'scenario')}.`,
      );
      backups.reload();
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' });
    }
  };

  const doClear = async () => {
    setBusy(true);
    try {
      const r = await clearAll(opts);
      setConfirm(false);
      backups.reload();
      toast.show(
        `Cleared ${plural(r.deletedCases, 'test case')}, ${plural(r.deletedScenarios, 'scenario')} (${plural(r.deletedFiles, 'file')}) and the parameters of ${plural(r.clearedValues, 'test case')}.`,
        r.backupId
          ? { action: { label: 'Undo', onClick: () => void restore(r.backupId!) } }
          : undefined,
      );
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const p = settings.data?.paths;
  return (
    <>
      <Panel
        title="Where data is kept"
        description="Test cases, steps, parameters, runs and settings are all in the database. Screenshots and other evidence from runs are files."
      >
        {p ? (
          <dl style={{ display: 'grid', gap: 'var(--space-3)', margin: 0 }}>
            {[
              ['Database', p.database],
              ['Run evidence', p.artifacts],
            ].map(([k, v]) => (
              <div key={k}>
                <dt
                  style={{
                    color: 'var(--color-text-muted)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 600,
                  }}
                >
                  {k}
                </dt>
                <dd style={{ margin: 0 }}>
                  <code>{v ?? '—'}</code>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          'Loading…'
        )}
      </Panel>

      <Panel
        title="Clear all data"
        description="Start fresh. A backup is taken first, so you can undo for 7 days."
      >
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <Checkbox label="Test cases" hint="Always removed." checked disabled />
          <Checkbox
            label="Their steps"
            checked={opts.scenarios}
            onChange={(e) => setOpts({ ...opts, scenarios: e.target.checked })}
          />
          <Checkbox
            label="Their parameters"
            hint="The values steps read as {{data.name}}."
            checked={opts.parameters}
            onChange={(e) => setOpts({ ...opts, parameters: e.target.checked })}
          />
          <Checkbox
            label="Run history"
            hint="Results and reports of past runs."
            checked={opts.runs}
            onChange={(e) => setOpts({ ...opts, runs: e.target.checked })}
          />
          <div>
            <Button variant="danger" icon="trash" onClick={() => setConfirm(true)}>
              Clear all data
            </Button>
          </div>
        </div>
      </Panel>

      <Panel
        title="Backups"
        description="Taken automatically before each clear. Restoring adds the data back; nothing current is deleted."
      >
        {backups.error && <Alert tone="danger">{backups.error}</Alert>}
        {(backups.data ?? []).length === 0 ? (
          <EmptyState icon="history" title="No backups" />
        ) : (
          <ul
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
              margin: 0,
              padding: 0,
              listStyle: 'none',
            }}
          >
            {backups.data!.map((b) => (
              <li
                key={b.id}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-3) 0',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <strong>{formatDate(b.createdAt)}</strong>
                <span style={{ flex: 1, color: 'var(--color-text-secondary)' }}>
                  {plural(b.cases, 'test case')} · {plural(b.scenarios, 'scenario')} ·{' '}
                  {plural(b.parameterSets, 'parameter set')}
                </span>
                <Button size="sm" icon="history" onClick={() => void restore(b.id)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {confirm && (
        <ConfirmDialog
          title="Clear all data?"
          confirmLabel="Clear all data"
          danger
          busy={busy}
          typeToConfirm={CONFIRM_WORD}
          onCancel={() => setConfirm(false)}
          onConfirm={() => void doClear()}
        >
          This removes every test case{opts.scenarios ? ', their steps and TC files' : ''}
          {opts.parameters ? ', their parameters' : ''}
          {opts.runs ? ' and the run history' : ''}. Settings and test accounts are kept. A backup
          is taken first.
        </ConfirmDialog>
      )}
    </>
  );
}
