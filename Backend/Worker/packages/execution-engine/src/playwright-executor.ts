import fs from 'node:fs';
import path from 'node:path';
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright';
import {
  LEGACY_PAGES,
  runScenario,
  signIn,
  SignInError,
  waitForManualSignIn,
  type ActionEnv,
  type ActionRegistry,
  type Credentials,
  type PageSpec,
} from '@qa-studio/automation-core';
import type { AppSettings, Logger, StepResult } from '@qa-studio/shared';
import type { CaseExecutor, CaseJob, CaseOutcome } from './run-manager.js';

/** A directory-safe name derived from a test case ID. Prevents path traversal via crafted IDs. */
export function safeName(id: string): string {
  const s = id.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_');
  return s.slice(0, 80) || '_';
}

export interface PlaywrightExecutorOptions {
  /**
   * Current settings for a case's project. Read for every case, so a change in the app applies to the next case.
   * Throws if unusable.
   */
  getSettings(projectId?: number): AppSettings;
  /** Credentials for an account. Used only to sign in; never logged, stored in results or put in artifacts. */
  getCredentials(accountId: string): Credentials | undefined;
  registry: ActionRegistry;
  pages?: Record<string, PageSpec>;
  /**
   * The page list from Settings › Pages for a case's project (shared pages plus the project's own). Read for every
   * case, so an edit applies to the next case.
   */
  getPages?(projectId?: number): Record<string, PageSpec>;
  artifactsDir: string;
  log: Logger;
  allowDestructive?: boolean;
  /** The test case's parameters for `{{data.name}}` in its steps. Read for every case, so edits apply to the next run. */
  getData?(caseId: string): Record<string, string>;
  /** The saved browser session of an account (sign-in method "saved-session"). Never logged or stored in results. */
  getSession?(accountId: string): string | undefined;
}

type StorageState = Exclude<Parameters<Browser['newContext']>[0], undefined>['storageState'];

/** A saved session as Playwright needs it, or undefined if it cannot be read. */
function storageState(session: string | undefined): StorageState | undefined {
  if (!session) return undefined;
  try {
    return JSON.parse(session) as StorageState;
  } catch {
    return undefined;
  }
}

/** How long a person has to finish signing in by hand (including any second factor). */
export const MANUAL_SIGN_IN_MS = 5 * 60_000;

const launchers = { chromium, firefox, webkit };

const SNAPSHOT_LIMIT = 20_000;

/** Replace every secret with a mask; secrets shorter than 4 characters are ignored (they would mask ordinary words). */
function mask(text: string, secrets: string[]): string {
  return secrets
    .filter((s) => s.length >= 4)
    .sort((a, b) => b.length - a.length)
    .reduce((t, s) => t.split(s).join('[redacted]'), text);
}

/**
 * The page as an accessibility outline (roles, names, visible text), with its address. Bounded in size and with
 * secrets removed, because it is stored and may be sent to a model.
 */
export async function pageSnapshot(page: Page, secrets: string[]): Promise<string | undefined> {
  try {
    const outline = await page.locator('body').ariaSnapshot({ timeout: 5000 });
    const text = `URL: ${page.url()}\nTitle: ${await page.title()}\n\n${outline}`;
    return mask(
      text.length > SNAPSHOT_LIMIT ? `${text.slice(0, SNAPSHOT_LIMIT)}\n… (cut)` : text,
      secrets,
    );
  } catch {
    return undefined;
  }
}

export interface ExploredPage {
  path: string;
  ok: boolean;
  url?: string;
  title?: string;
  snapshot?: string;
  error?: string;
  /** Requests that would have changed data and were stopped. Pages that read data through POST may look empty. */
  blockedWrites: number;
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const blocked = (
  message: string,
  steps: StepResult[] = [],
  artifacts: string[] = [],
): CaseOutcome => ({
  status: 'blocked',
  steps,
  failure: { kind: 'blocked', message },
  artifacts,
});

/**
 * Runs each case in its own browser: open a fresh browser window, load the app, sign in as the job's account,
 * then run the scenario. Nothing is shared between cases or accounts.
 */
export class PlaywrightExecutor implements CaseExecutor {
  private readonly open = new Set<Browser>();
  /** `${runId}:${accountId}` -> why sign-in failed. Stops us hammering an account that may lock out. */
  private readonly signInFailures = new Map<string, string>();

  constructor(private readonly o: PlaywrightExecutorOptions) {}

  /** Close any browser still open (for shutdown). */
  async close(): Promise<void> {
    await Promise.all([...this.open].map((b) => b.close().catch(() => undefined)));
    this.open.clear();
  }

  private async launch(s: AppSettings): Promise<Browser> {
    const browser = await launchers[s.browser].launch({ headless: s.headless, slowMo: s.slowMoMs });
    this.open.add(browser);
    browser.on('disconnected', () => this.open.delete(browser));
    return browser;
  }

  /**
   * Open a visible browser on the app's login page and wait while a person signs in by hand (any SSO, any second
   * factor). Returns the browser session to save. The platform types nothing.
   */
  async captureSession(s: AppSettings, timeoutMs = MANUAL_SIGN_IN_MS): Promise<string> {
    const browser = await launchers[s.browser].launch({ headless: false });
    this.open.add(browser);
    try {
      const context = await browser.newContext({ baseURL: s.appUrl });
      const page = await context.newPage();
      await waitForManualSignIn(
        page,
        { ...s.login, baseUrl: s.appUrl, timeoutMs: s.timeoutMs },
        timeoutMs,
      );
      return JSON.stringify(await context.storageState());
    } finally {
      this.open.delete(browser);
      await browser.close().catch(() => undefined);
    }
  }

  /** Try a real sign-in with the given account and report whether it worked. Used by "Test sign-in". */
  async testSignIn(
    s: AppSettings,
    creds: Credentials,
    session?: string,
  ): Promise<{ ok: boolean; message: string }> {
    const browser = await this.launch(s);
    try {
      const state = storageState(session);
      const page = await (
        await browser.newContext({ baseURL: s.appUrl, ...(state && { storageState: state }) })
      ).newPage();
      await signIn(page, { ...s.login, baseUrl: s.appUrl, timeoutMs: s.timeoutMs }, creds);
      return { ok: true, message: 'Signed in successfully.' };
    } catch (e) {
      return { ok: false, message: e instanceof SignInError ? e.message : 'Sign-in failed.' };
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  /**
   * Look at pages of the app without changing anything: sign in (which needs to post a form), then refuse every
   * request that is not a read, visit each same-origin path, and record what the page shows. No clicks, no typing.
   */
  async explore(
    s: AppSettings,
    creds: Credentials | undefined,
    paths: string[],
    session?: string,
  ): Promise<ExploredPage[]> {
    const browser = await launchers[s.browser].launch({ headless: true });
    this.open.add(browser);
    try {
      const state = storageState(session);
      const context = await browser.newContext({
        baseURL: s.appUrl,
        ...(state && { storageState: state }),
      });
      const page = await context.newPage();
      if (s.login.strategy === 'saved-session' && !state) {
        throw new SignInError(
          'This account has no saved session. In Settings, use "Sign in by hand" first.',
        );
      }
      if (s.login.strategy !== 'none') {
        if (!creds) throw new SignInError('Choose a test account to explore as.');
        await signIn(page, { ...s.login, baseUrl: s.appUrl, timeoutMs: s.timeoutMs }, creds);
      }
      let blockedWrites = 0;
      await context.route('**/*', (route) => {
        if (READ_METHODS.has(route.request().method())) return route.continue();
        blockedWrites++;
        return route.abort('blockedbyclient');
      });
      const origin = new URL(s.appUrl).origin;
      const out: ExploredPage[] = [];
      for (const p of paths) {
        const before = blockedWrites;
        const target = new URL(p, s.appUrl);
        if (target.origin !== origin) {
          out.push({
            path: p,
            ok: false,
            error: 'Only pages of the app under test can be explored.',
            blockedWrites: 0,
          });
          continue;
        }
        try {
          await page.goto(target.toString(), { timeout: s.timeoutMs });
          await page
            .waitForLoadState('networkidle', { timeout: Math.min(s.timeoutMs, 10_000) })
            .catch(() => undefined);
          const snapshot = await pageSnapshot(page, creds ? [creds.password] : []);
          out.push({
            path: p,
            ok: snapshot !== undefined,
            url: page.url(),
            title: await page.title(),
            ...(snapshot ? { snapshot } : { error: 'The page could not be read.' }),
            blockedWrites: blockedWrites - before,
          });
        } catch (e) {
          out.push({
            path: p,
            ok: false,
            error: e instanceof Error ? e.message.split('\n')[0]! : 'The page did not load.',
            blockedWrites: blockedWrites - before,
          });
        }
      }
      return out;
    } finally {
      this.open.delete(browser);
      await browser.close().catch(() => undefined);
    }
  }

  async execute(job: CaseJob, ctx: { runId: string; signal: AbortSignal }): Promise<CaseOutcome> {
    const { o } = this;
    const log = o.log.child({ runId: ctx.runId, caseId: job.caseId, account: job.account?.label });

    let settings: AppSettings;
    try {
      settings = o.getSettings(job.projectId);
    } catch (e) {
      return blocked(e instanceof Error ? e.message : 'Settings are not ready.');
    }

    const needsSignIn = settings.login.strategy !== 'none';
    const savedSession = settings.login.strategy === 'saved-session';
    let creds: Credentials = { username: '', password: '' };
    let state: StorageState | undefined;
    const failureKey = `${ctx.runId}:${job.account?.id ?? ''}`;
    if (needsSignIn) {
      if (!job.account)
        return blocked(
          'No test account was chosen for this run. Choose an account before running.',
        );
    }
    if (needsSignIn && savedSession && job.account) {
      state = storageState(o.getSession?.(job.account.id));
      if (!state) {
        return blocked(
          `"${job.account.label}" has no saved session. In Settings, use "Sign in by hand" for this account, then run again.`,
        );
      }
    } else if (needsSignIn && job.account) {
      const found = o.getCredentials(job.account.id);
      if (!found) {
        return blocked(
          `The password for account "${job.account.label}" is missing. Open Settings and enter it again.`,
        );
      }
      creds = found;
      const earlier = this.signInFailures.get(failureKey);
      if (earlier) {
        return blocked(
          `Not signing in again as "${job.account.label}" because an earlier sign-in in this run failed (${earlier}). This avoids locking the account.`,
        );
      }
    }

    const rel = safeName(job.caseId) + (job.account ? `--${safeName(job.account.label)}` : '');
    const caseDir = path.join(path.resolve(o.artifactsDir, safeName(ctx.runId)), rel);
    fs.mkdirSync(caseDir, { recursive: true });

    const browser = await this.launch(settings);
    const onAbort = () => void browser.close().catch(() => undefined);
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    const artifacts: string[] = [];
    try {
      // A fresh browser and context per case: no cookies, storage or pages shared with any other case.
      const context = await browser.newContext({
        baseURL: settings.appUrl,
        ...(state && { storageState: state }),
      });
      const page = await context.newPage();

      // Sign in BEFORE tracing starts: a trace records typed values, which would include the password.
      const steps: StepResult[] = [];
      const started = Date.now();
      try {
        await signIn(
          page,
          { ...settings.login, baseUrl: settings.appUrl, timeoutMs: settings.timeoutMs },
          creds,
        );
      } catch (e) {
        if (ctx.signal.aborted) {
          return {
            status: 'cancelled',
            steps,
            artifacts,
            failure: { kind: 'cancelled', message: 'Cancelled by user.' },
          };
        }
        const reason = e instanceof SignInError ? e.message : 'Sign-in failed.';
        this.signInFailures.set(failureKey, reason);
        await page.screenshot({ path: path.join(caseDir, 'sign-in-failed.png') }).then(
          () => artifacts.push(`${rel}/sign-in-failed.png`),
          () => undefined,
        );
        log.warn('sign-in failed', { reason });
        return blocked(
          `Could not sign in as "${job.account?.label ?? 'the test account'}": ${reason}`,
          [
            {
              index: 0,
              action: 'auth.sign-in',
              status: 'failed',
              durationMs: Date.now() - started,
              failure: { kind: 'blocked', message: reason },
            },
          ],
          artifacts,
        );
      }
      if (needsSignIn)
        steps.push({
          index: 0,
          action: 'auth.sign-in',
          status: 'passed',
          durationMs: Date.now() - started,
        });

      await context.tracing.start({ screenshots: true, snapshots: true }).catch(() => undefined);
      log.info('case started');
      const env: ActionEnv = {
        baseUrl: settings.appUrl,
        timeoutMs: settings.timeoutMs,
        pages: o.getPages?.(job.projectId) ?? o.pages ?? LEGACY_PAGES,
        ...((job.data ?? o.getData) && { data: job.data ?? o.getData!(job.caseId) }),
      };
      const out = await runScenario(
        o.registry,
        job.scenario!,
        { page, env, log, signal: ctx.signal },
        {
          stepTimeoutMs: settings.timeoutMs * 2,
          ...(o.allowDestructive !== undefined && { allowDestructive: o.allowDestructive }),
        },
      );
      const shift = steps.length; // scenario steps follow the sign-in step
      steps.push(...out.steps.map((s) => ({ ...s, index: s.index + shift })));

      if (out.status === 'failed' && !ctx.signal.aborted) {
        await page.screenshot({ path: path.join(caseDir, 'failure.png') }).then(
          () => artifacts.push(`${rel}/failure.png`),
          () => undefined,
        );
        // What the page said when it failed, as text: lets a person (or the diagnosis) see the screen without the trace.
        const snapshot = await pageSnapshot(page, [creds.password]);
        if (snapshot) {
          fs.writeFileSync(path.join(caseDir, 'failure-page.txt'), snapshot);
          artifacts.push(`${rel}/failure-page.txt`);
        }
        await context.tracing.stop({ path: path.join(caseDir, 'trace.zip') }).then(
          () => artifacts.push(`${rel}/trace.zip`),
          () => undefined,
        );
      } else {
        await context.tracing.stop().catch(() => undefined);
      }
      log.info('case finished', { status: out.status });
      return { status: out.status, steps, artifacts, ...(out.failure && { failure: out.failure }) };
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
      await browser.close().catch(() => undefined);
    }
  }
}
