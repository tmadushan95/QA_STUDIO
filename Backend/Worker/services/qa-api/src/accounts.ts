import crypto from 'node:crypto';
import { z } from 'zod';
import type { Credentials } from '@qa-studio/automation-core';
import { HttpError } from './errors.js';
import type { SecretBox } from './secrets.js';
import type { AccountRow } from './sqlite-storage.js';

/** What the API and screens may see of an account. There is deliberately no password in here. */
export interface AccountView {
  id: string;
  /** The project this account signs in to. */
  projectId: number;
  label: string;
  username: string;
  /** False when no password is stored, or it can no longer be decrypted (for example the key file was lost). */
  hasPassword: boolean;
  /** When a browser session was last saved by signing in by hand. Absent when there is none. */
  sessionSavedAt?: string;
}

export interface AccountStore {
  listAccounts(): AccountRow[];
  getAccount(id: string): AccountRow | undefined;
  saveAccount(row: AccountRow): void;
  deleteAccount(id: string): boolean;
  loadSession?(accountId: string): { stateEnc: string; savedAt: string } | undefined;
  saveSession?(accountId: string, stateEnc: string): void;
  deleteSession?(accountId: string): boolean;
}

export interface AccountServiceDeps {
  store: AccountStore;
  box: SecretBox;
  /** Record a configuration change. Never pass secrets. */
  audit(action: string, target: string, detail: string): void;
  /** Try a real sign-in with the credentials. Throws an HttpError when sign-in testing is not possible yet. */
  tester(
    creds: Credentials,
    session: string | undefined,
    projectId: number,
  ): Promise<{ ok: boolean; message: string }>;
  /** Open a visible browser on the project's app, let a person sign in by hand, and return the session to keep. */
  capturer?(projectId: number): Promise<string>;
  /** Whether the project signs in by "saved session" (then a test checks the session, not the password). */
  usesSavedSession?(projectId: number): boolean;
}

const Label = z
  .string()
  .trim()
  .min(1, 'Enter a name for this account.')
  .max(60, 'Use 60 characters or fewer.');
const Username = z
  .string()
  .trim()
  .min(1, 'Enter the username.')
  .max(200, 'Use 200 characters or fewer.');
const Password = z.string().min(1, 'Enter the password.').max(500, 'Use 500 characters or fewer.');

const CreateInput = z.object({
  projectId: z.number({ message: 'Choose a project.' }).int().positive('Choose a project.'),
  label: Label,
  username: Username,
  password: Password,
});
const UpdateInput = z.object({
  label: Label.optional(),
  username: Username.optional(),
  // Empty or missing means "keep the saved password".
  password: z.union([z.literal(''), Password]).optional(),
});

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const fields = Object.fromEntries(
    r.error.issues.map((i) => [i.path.join('.') || 'form', i.message]),
  );
  throw new HttpError(400, 'invalid-account', Object.values(fields).join(' '), fields);
}

/** Test accounts. Passwords are encrypted before they reach storage and never leave this class except via `credentials`. */
export class AccountService {
  private testing = false;

  constructor(private readonly d: AccountServiceDeps) {}

  private view(r: AccountRow): AccountView {
    const session = this.d.store.loadSession?.(r.id);
    return {
      id: r.id,
      projectId: r.projectId,
      label: r.label,
      username: r.username,
      hasPassword: this.d.box.decrypt(r.passwordEnc) !== undefined,
      ...(session && { sessionSavedAt: session.savedAt }),
    };
  }

  /** The saved browser session, decrypted, for a run. Undefined when there is none or it cannot be read. */
  session(id: string): string | undefined {
    const s = this.d.store.loadSession?.(id);
    return s && this.d.box.decrypt(s.stateEnc);
  }

  /** Open a visible browser for a person to sign in as this account by hand, then keep that session (encrypted). */
  async captureSession(id: string): Promise<AccountView> {
    const row = this.d.store.getAccount(id);
    if (!row) throw new HttpError(404, 'unknown-account', 'That account no longer exists.');
    if (!this.d.capturer || !this.d.store.saveSession) {
      throw new HttpError(404, 'capture-unavailable', 'Signing in by hand is not available here.');
    }
    if (this.testing)
      throw new HttpError(
        409,
        'test-in-progress',
        'A sign-in is already in progress. Finish it first.',
      );
    this.testing = true;
    try {
      const state = await this.d.capturer(row.projectId);
      this.d.store.saveSession(id, this.d.box.encrypt(state));
      this.d.audit('account.session', row.label, 'Signed in by hand; session saved.'); // never the session itself
      return this.view(this.d.store.getAccount(id)!);
    } finally {
      this.testing = false;
    }
  }

  clearSession(id: string): AccountView {
    const row = this.d.store.getAccount(id);
    if (!row) throw new HttpError(404, 'unknown-account', 'That account no longer exists.');
    if (this.d.store.deleteSession?.(id))
      this.d.audit('account.session.clear', row.label, 'Saved session removed.');
    return this.view(row);
  }

  list(): AccountView[] {
    return this.d.store.listAccounts().map((r) => this.view(r));
  }

  /** Labels are unique within a project: two projects may each have their own "Approver". */
  private assertLabelFree(label: string, projectId: number, exceptId?: string): void {
    const clash = this.d.store
      .listAccounts()
      .find(
        (a) =>
          a.projectId === projectId &&
          a.label.toLowerCase() === label.toLowerCase() &&
          a.id !== exceptId,
      );
    if (clash)
      throw new HttpError(
        409,
        'duplicate-label',
        `An account named "${label}" already exists. Use a different name.`,
        { label: 'Already used.' },
      );
  }

  create(input: unknown): AccountView {
    const a = parse(CreateInput, input);
    this.assertLabelFree(a.label, a.projectId);
    const now = new Date().toISOString();
    const row: AccountRow = {
      id: crypto.randomUUID(),
      projectId: a.projectId,
      label: a.label,
      username: a.username,
      passwordEnc: this.d.box.encrypt(a.password),
      createdAt: now,
      updatedAt: now,
    };
    this.d.store.saveAccount(row);
    this.d.audit('account.create', a.label, 'Account added.');
    return this.view(row);
  }

  update(id: string, input: unknown): AccountView {
    const row = this.d.store.getAccount(id);
    if (!row) throw new HttpError(404, 'unknown-account', 'That account no longer exists.');
    const a = parse(UpdateInput, input);
    const changed: string[] = [];
    const next = { ...row };
    if (a.label !== undefined && a.label !== row.label) {
      this.assertLabelFree(a.label, row.projectId, id);
      next.label = a.label;
      changed.push('name');
    }
    if (a.username !== undefined && a.username !== row.username) {
      next.username = a.username;
      changed.push('username');
    }
    if (a.password) {
      next.passwordEnc = this.d.box.encrypt(a.password);
      changed.push('password');
    }
    if (changed.length > 0) {
      next.updatedAt = new Date().toISOString();
      this.d.store.saveAccount(next);
      this.d.audit('account.update', next.label, `Changed: ${changed.join(', ')}.`);
    }
    return this.view(next);
  }

  remove(id: string): void {
    const row = this.d.store.getAccount(id);
    if (!row || !this.d.store.deleteAccount(id))
      throw new HttpError(404, 'unknown-account', 'That account no longer exists.');
    this.d.store.deleteSession?.(id); // a session must not outlive its account
    this.d.audit('account.delete', row.label, 'Account removed.');
  }

  /** Resolve account ids to the labels people see. Unknown ids are an error, not silently dropped. */
  refs(ids: string[]): { id: string; label: string; projectId: number }[] {
    return ids.map((id) => {
      const row = this.d.store.getAccount(id);
      if (!row)
        throw new HttpError(
          404,
          'unknown-account',
          'One of the chosen accounts no longer exists. Refresh and choose again.',
        );
      return { id: row.id, label: row.label, projectId: row.projectId };
    });
  }

  /** The only way to read a password back: for signing in. Undefined if it is missing or unreadable. */
  credentials(id: string): Credentials | undefined {
    const row = this.d.store.getAccount(id);
    const password = row && this.d.box.decrypt(row.passwordEnc);
    return row && password !== undefined ? { username: row.username, password } : undefined;
  }

  /** Try a real sign-in. One test at a time, so a button click cannot hammer an account. */
  async test(id: string): Promise<{ ok: boolean; message: string }> {
    const row = this.d.store.getAccount(id);
    if (!row) throw new HttpError(404, 'unknown-account', 'That account no longer exists.');
    const saved = this.d.usesSavedSession?.(row.projectId) === true;
    const session = saved ? this.session(id) : undefined;
    if (saved && !session) {
      throw new HttpError(
        409,
        'session-missing',
        `"${row.label}" has no saved session yet. Use "Sign in by hand" first.`,
      );
    }
    const creds = saved ? { username: row.username, password: '' } : this.credentials(id);
    if (!creds)
      throw new HttpError(
        409,
        'password-missing',
        `The password for "${row.label}" is missing. Enter it again.`,
      );
    if (this.testing)
      throw new HttpError(
        409,
        'test-in-progress',
        'A sign-in test is already running. Wait for it to finish.',
      );
    this.testing = true;
    try {
      const result = await this.d.tester(creds, session, row.projectId);
      this.d.audit(
        'account.test',
        row.label,
        result.ok ? 'Sign-in test passed.' : 'Sign-in test failed.',
      );
      return result;
    } finally {
      this.testing = false;
    }
  }
}
