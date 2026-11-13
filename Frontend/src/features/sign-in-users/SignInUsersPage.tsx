/**
 * Sign-in Users: every project's test users in one place.
 *
 * A project can hold many users (for example an admin, an approver and two requesters). Choosing several of them when
 * starting a run — or "Concurrent run" on Test Execution — runs the same cases as each of them at the same time, which
 * is how races, locking and "two people edit the same record" scenarios are checked.
 *
 * Passwords are write-only: they are encrypted on the server and never shown again. Each project's own panel is the
 * same component as on the project's setup page, so test sign-in, saved sessions and deleting work identically.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  Field,
  Icon,
  IconButton,
  PageHeader,
  TextInput,
  useToast,
} from '../../design-system/index.js';
import { errorMessage } from '../../shared/api/http.js';
import { useLive } from '../../shared/api/live.js';
import { useResource } from '../../shared/hooks/useAsync.js';
import { href } from '../../shared/hooks/useRoute.js';
import { plural } from '../../shared/lib/format.js';
import {
  createAccount,
  fetchAccounts,
  fetchConnections,
  fetchProjects,
  ProjectAccounts,
  type Project,
  useProjectScope,
} from '../master-data/index.js';
import styles from './SignInUsersPage.module.css';

/** The Sign-in Users page. */
export function SignInUsersPage() {
  const data = useResource(async () => {
    const [projects, accounts, connections] = await Promise.all([
      fetchProjects(),
      fetchAccounts(),
      fetchConnections(),
    ]);
    return { projects, accounts, connections: connections.items };
  });
  useLive((e) => e.type === 'data' && data.reload());
  const projectId = useProjectScope().project?.id ?? 0;
  const [adding, setAdding] = useState<Project>();

  const projects = data.data?.projects ?? [];
  const accounts = data.data?.accounts ?? [];
  const shown = projects.filter((p) => !projectId || p.id === projectId);
  const signsIn = (projectId: number) =>
    data.data?.connections.find((c) => c.projectId === projectId)?.login.strategy;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Sign-in Users"
        description="The test users this project signs in as. Add several to run the same cases as different people at once."
      />

      <div className={styles.facts}>
        <Fact icon="users" value={accounts.length} label="Sign-in users" />
        <Fact
          icon="folder"
          value={new Set(accounts.map((a) => a.projectId)).size}
          label="Projects with users"
        />
        <Fact
          icon="key"
          value={accounts.filter((a) => a.sessionSavedAt).length}
          label="Saved sessions (SSO)"
        />
        <div className={styles.tip}>
          <Icon name="execute" />
          <p>
            <strong>Concurrent scenarios:</strong> on <a href={href('execution')}>Test Execution</a>
            , choose “Concurrent run” to run the selected cases as every user of their project at
            the same time.
          </p>
        </div>
      </div>

      {data.error && <Alert tone="danger">{data.error}</Alert>}
      {data.loading && !data.data && <EmptyState icon="refresh" title="Loading users…" />}
      {data.data && shown.length === 0 && (
        <EmptyState
          icon="folder"
          title="No project yet"
          action={
            <a className="button-link" href={href('home')}>
              Add a project
            </a>
          }
        >
          Users belong to a project. Add one first.
        </EmptyState>
      )}

      {shown.map((p) => {
        const strategy = signsIn(p.id);
        const own = accounts.filter((a) => a.projectId === p.id);
        return (
          <section key={p.id} className={styles.project} aria-label={p.name}>
            <div className={styles.projectHead}>
              <div>
                <h2 className={styles.projectName}>{p.name}</h2>
                <p className={styles.muted}>
                  {plural(own.length, 'user')} ·{' '}
                  {strategy === undefined
                    ? 'sign-in not set up'
                    : strategy === 'none'
                      ? 'no sign-in needed'
                      : `signs in with ${strategy.replace('-', ' ')}`}
                </p>
              </div>
              <div className={styles.projectActions}>
                <a className="button-link" href={href('project-settings', 'general')}>
                  Project setup
                </a>
                <Button icon="users" onClick={() => setAdding(p)} disabled={strategy === 'none'}>
                  Add several users
                </Button>
              </div>
            </div>
            <ProjectAccounts
              projectId={p.id}
              accounts={own}
              strategy={strategy}
              blockedReason={
                strategy === undefined
                  ? 'Set up the project’s application and sign-in first.'
                  : undefined
              }
              onChanged={data.reload}
            />
          </section>
        );
      })}

      {adding && (
        <BulkAddDialog
          project={adding}
          onClose={() => setAdding(undefined)}
          onDone={() => {
            setAdding(undefined);
            data.reload();
          }}
        />
      )}
    </div>
  );
}

function Fact({
  icon,
  value,
  label,
}: {
  icon: 'users' | 'folder' | 'key';
  value: number;
  label: string;
}) {
  return (
    <div className={styles.fact}>
      <span className={styles.factIcon}>
        <Icon name={icon} />
      </span>
      <span>
        <span className={styles.factValue}>{value}</span>
        <span className={styles.muted}>{label}</span>
      </span>
    </div>
  );
}

interface Draft {
  label: string;
  username: string;
  password: string;
}

const EMPTY: Draft = { label: '', username: '', password: '' };

/** Add several users of one project at once; each row is saved on its own, so one bad row does not lose the rest. */
function BulkAddDialog({
  project,
  onClose,
  onDone,
}: {
  project: Project;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<Draft[]>([{ ...EMPTY }, { ...EMPTY }]);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const filled = rows.filter((r) => r.label.trim() && r.username.trim() && r.password);
  const dirty = rows.some((r) => r.label || r.username || r.password);

  const set = (i: number, patch: Partial<Draft>) =>
    setRows(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setBusy(true);
    const failed: Record<number, string> = {};
    let saved = 0;
    for (const [i, r] of rows.entries()) {
      if (!r.label.trim() || !r.username.trim() || !r.password) continue;
      try {
        await createAccount({
          projectId: project.id,
          label: r.label.trim(),
          username: r.username.trim(),
          password: r.password,
        });
        saved++;
      } catch (e) {
        failed[i] = errorMessage(e);
      }
    }
    setBusy(false);
    if (saved > 0) toast.show(`Added ${plural(saved, 'user')} to ${project.name}.`);
    if (Object.keys(failed).length === 0) onDone();
    else {
      // Keep only the rows that failed, with their reasons, so they can be corrected and saved again.
      setRows(rows.filter((_, i) => failed[i] !== undefined));
      setErrors(Object.fromEntries(Object.values(failed).map((m, n) => [n, m])));
    }
  };

  return (
    <Dialog
      title={`Add users to ${project.name}`}
      subtitle="Each needs a name people recognise (such as Approver), a username and a password."
      size="lg"
      dirty={dirty}
      onClose={onClose}
      onSave={() => void save()}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={filled.length === 0}
            onClick={() => void save()}
          >
            Add {filled.length > 0 ? plural(filled.length, 'user') : 'users'}
          </Button>
        </>
      }
    >
      <div className={styles.bulk}>
        {rows.map((r, i) => (
          <fieldset key={i} className={styles.bulkRow}>
            <legend className="visually-hidden">User {i + 1}</legend>
            <Field label="Name" error={errors[i]}>
              {(p) => (
                <TextInput
                  {...p}
                  value={r.label}
                  placeholder="Approver"
                  onChange={(e) => set(i, { label: e.target.value })}
                />
              )}
            </Field>
            <Field label="Username">
              {(p) => (
                <TextInput
                  {...p}
                  value={r.username}
                  autoComplete="off"
                  onChange={(e) => set(i, { username: e.target.value })}
                />
              )}
            </Field>
            <Field label="Password">
              {(p) => (
                <TextInput
                  {...p}
                  type="password"
                  autoComplete="new-password"
                  value={r.password}
                  onChange={(e) => set(i, { password: e.target.value })}
                />
              )}
            </Field>
            <IconButton
              icon="trash"
              label={`Remove user ${i + 1}`}
              variant="ghost"
              disabled={rows.length === 1}
              onClick={() => setRows(rows.filter((_, n) => n !== i))}
            />
          </fieldset>
        ))}
        <div>
          <Button
            icon="plus"
            size="sm"
            onClick={() => setRows([...rows, { ...EMPTY }])}
            disabled={rows.length >= 20}
          >
            Another user
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
