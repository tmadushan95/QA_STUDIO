/**
 * A project's test accounts: the accounts runs of this project sign in as. Passwords are write-only (stored encrypted,
 * never shown or sent anywhere else). For sign-in with a second factor, a person signs in by hand once and the session
 * is saved.
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Menu,
  Panel,
  TextInput,
  useToast,
} from '../../design-system/index.js';
import { ApiError, errorMessage } from '../../shared/api/http.js';
import { formatDate } from '../../shared/lib/format.js';
import type { LoginStrategy } from '../settings/api.js';
import {
  captureSession,
  createAccount,
  deleteAccount,
  testAccount,
  updateAccount,
  type Account,
} from './api.js';
import styles from './Projects.module.css';

/** Props of `ProjectAccounts`. */
export interface ProjectAccountsProps {
  projectId: number;
  /** This project's accounts. */
  accounts: Account[];
  /** The saved sign-in method. */
  strategy: LoginStrategy | undefined;
  /** Why signing in cannot be tried yet: tests use what is saved, not what is on screen. */
  blockedReason: string | undefined;
  onChanged: () => void;
}

/** The panel listing a project's test accounts, with forms to add, edit, test and delete them. */
export function ProjectAccounts({
  projectId,
  accounts,
  strategy,
  blockedReason,
  onChanged,
}: Readonly<ProjectAccountsProps>) {
  const toast = useToast();
  const [editing, setEditing] = useState<Account | 'new'>();
  const [removing, setRemoving] = useState<Account>();
  const [busy, setBusy] = useState<string>();

  const run = async (id: string, fn: () => Promise<string>) => {
    setBusy(id);
    try {
      toast.show(await fn());
      onChanged();
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'danger' });
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Panel
      title="Test accounts"
      description="Runs of this project sign in as these accounts. Choose which ones when you start a run."
      actions={
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
          Add account
        </Button>
      }
    >
      {strategy === 'none' && (
        <Alert tone="info">This project signs in with nothing, so runs do not use accounts.</Alert>
      )}
      {blockedReason && <Alert tone="warning">{blockedReason}</Alert>}
      {accounts.length === 0 ? (
        <EmptyState icon="settings" title="No test accounts">
          Add one for each role you test with, such as an approver and a viewer.
        </EmptyState>
      ) : (
        <ul className={styles.accounts}>
          {accounts.map((a) => (
            <li key={a.id} className={styles.account}>
              <span className={styles.accountName}>
                <strong>{a.label}</strong>
                <span className={styles.accountUser}>{a.username}</span>
              </span>
              {a.hasPassword ? (
                <Badge tone="success" glyph="✓">
                  Password saved
                </Badge>
              ) : (
                <Badge tone="warning" glyph="!">
                  No password
                </Badge>
              )}
              {a.sessionSavedAt && (
                <Badge tone="info">Session from {formatDate(a.sessionSavedAt)}</Badge>
              )}
              <Button
                size="sm"
                loading={busy === a.id}
                disabled={!!blockedReason || strategy === 'none'}
                onClick={() =>
                  void run(a.id, async () => {
                    const r = await testAccount(a.id);
                    if (!r.ok) throw new Error(r.message);
                    return `${a.label}: ${r.message}`;
                  })
                }
              >
                Test sign-in
              </Button>
              <Menu
                label={`Actions for ${a.label}`}
                items={[
                  { label: 'Edit', icon: 'settings', onSelect: () => setEditing(a) },
                  {
                    label: 'Sign in by hand and save session',
                    icon: 'refresh',
                    onSelect: () =>
                      void run(
                        a.id,
                        async () => (await captureSession(a.id), `Session saved for ${a.label}.`),
                      ),
                  },
                  { label: 'Delete', icon: 'trash', danger: true, onSelect: () => setRemoving(a) },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <AccountDialog
          projectId={projectId}
          account={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            onChanged();
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Delete ${removing.label}?`}
          confirmLabel="Delete"
          danger
          onCancel={() => setRemoving(undefined)}
          onConfirm={() =>
            void run(removing.id, async () => {
              await deleteAccount(removing.id);
              setRemoving(undefined);
              return `${removing.label} deleted.`;
            })
          }
        >
          Runs can no longer sign in as this account. Past results keep its name.
        </ConfirmDialog>
      )}
    </Panel>
  );
}

function AccountDialog({
  projectId,
  account,
  onClose,
  onSaved,
}: Readonly<{
  projectId: number;
  account: Account | undefined;
  onClose: () => void;
  onSaved: () => void;
}>) {
  const [label, setLabel] = useState(account?.label ?? '');
  const [username, setUsername] = useState(account?.username ?? '');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErrors({});
    setError('');
    try {
      if (account)
        await updateAccount(account.id, { label, username, ...(password && { password }) });
      else await createAccount({ projectId, label, username, password });
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields);
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={account ? `Edit ${account.label}` : 'Add a test account'}
      size="md"
      dirty={
        label !== (account?.label ?? '') || username !== (account?.username ?? '') || !!password
      }
      onClose={onClose}
      onSave={() => void save()}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save account
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {error && Object.keys(errors).length === 0 && <Alert tone="danger">{error}</Alert>}
        <Field
          label="Name"
          required
          error={errors['label']}
          hint="Shown in results, for example “Approver”."
        >
          {(p) => (
            <TextInput
              {...p}
              data-autofocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          )}
        </Field>
        <Field label="User name" required error={errors['username']}>
          {(p) => (
            <TextInput
              {...p}
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Password"
          required={!account}
          error={errors['password']}
          hint={
            account
              ? 'Leave empty to keep the saved password.'
              : 'Stored encrypted. It is never shown again.'
          }
        >
          {(p) => (
            <TextInput
              {...p}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
