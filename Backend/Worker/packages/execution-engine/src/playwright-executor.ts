import fs from 'node:fs';
import path from 'node:path';
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import {
  LEGACY_PAGES,
  runScenario,
  signIn,
  SignInError,
  waitForManualSignIn,
  waitSignedIn,
  type ActionEnv,
  type ActionRegistry,
  type Credentials,
  type PageSpec,
  type SignInConfig,
} from '@qa-studio/automation-core';
import type { AppSettings, Logger, RunMode, StepResult } from '@qa-studio/shared';
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

/**
 * The longest a case waits to see that a reused sign-in still works before signing in again. Short, because when the
 * sign-in has expired the full sign-in follows anyway.
 */
const RESUME_CHECK_MS = 15_000;

/** What a run keeps open between its cases in `clean` and `shared` mode. Released by `endRun`. */
interface RunPool {
  /** One browser per browser kind and launch options, shared by the run's cases. */
  browsers: Map<string, Promise<Browser>>;
  /** `clean`: each account's browser state, taken right after its first sign-in, so later cases start signed in. */
  states: Map<string, StorageState>;
  /** `shared`: each account's window, used by its cases one after another. */
  windows: Map<string, { context: BrowserContext; page: Page }>;
}

/** The window one case runs in, however the run's mode provides it. */
interface CaseWindow {
  context: BrowserContext;
  page: Page;
  /** True when the window may already be signed in as the account: a saved sign-in, or the shared window. */
  signedInBefore: boolean;
  /** Close what only this case needed. With `discard`, also drop what was kept for the account's later cases. */
  release(discard: boolean): Promise<void>;
  /** Stop the case at once (on cancel) by closing its window. */
  abort(): void;
}

/**
 * Which kept sign-in or window a job may reuse. Settings are read per case, so the key includes what decides whether a
 * sign-in still applies: the project, the account, the app's address and the sign-in method.
 */
const reuseKey = (job: CaseJob, s: AppSettings): string =>
  `${job.projectId ?? ''}|${job.account?.id ?? ''}|${s.appUrl}|${s.login.strategy}`;

/** How long a person has to finish signing in by hand (including any second factor). */
export const MANUAL_SIGN_IN_MS = 5 * 60_000;

const launchers = { chromium, firefox, webkit };

/**
 * A visible browser opens as a full (maximized) window and its pages use the window's real size, so a person watching
 * sees the application as they would use it. Headless runs keep Playwright's fixed viewport, so their screenshots do not
 * change. Only Chromium has a maximize switch; Firefox and WebKit open at their default window size.
 */
const fullWindow = (s: Pick<AppSettings, 'browser' | 'headless'>) =>
  s.headless ? {} : { ...(s.browser === 'chromium' && { args: ['--start-maximized'] }) };
const windowViewport = (s: Pick<AppSettings, 'headless'>) => (s.headless ? {} : { viewport: null });

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
 * Runs cases in a browser, signed in as the job's account, according to the run's mode:
 * - `concurrent` (or no mode): a fresh browser per case that signs in itself. Nothing is shared between cases.
 * - `clean`: one browser for the run; each account signs in once, and every case gets a new window (browser context)
 *   that starts from that signed-in state. Nothing else carries over between cases.
 * - `shared`: one browser for the run; each account signs in once and its cases run in the same window in turn.
 * The run manager never runs one account in two places at once, so a kept window is only ever used by one case.
 */
export class PlaywrightExecutor implements CaseExecutor {
  private readonly open = new Set<Browser>();
  /** `${runId}:${accountId}` -> why sign-in failed. Stops us hammering an account that may lock out. */
  private readonly signInFailures = new Map<string, string>();
  /** runId -> what the run keeps open between cases (`clean` and `shared` mode only). */
  private readonly pools = new Map<string, RunPool>();

  constructor(private readonly o: PlaywrightExecutorOptions) {}

  /** Close any browser still open (for shutdown). */
  async close(): Promise<void> {
    this.pools.clear();
    await Promise.all([...this.open].map((b) => b.close().catch(() => undefined)));
    this.open.clear();
  }

  /** Close everything the run kept open between its cases. */
  async endRun(runId: string): Promise<void> {
    const pool = this.pools.get(runId);
    if (!pool) return;
    this.pools.delete(runId);
    const browsers = await Promise.all(
      [...pool.browsers.values()].map((p) => p.catch(() => undefined)),
    );
    await Promise.all(browsers.map((b) => b?.close().catch(() => undefined)));
  }

  private pool(runId: string): RunPool {
    let pool = this.pools.get(runId);
    if (!pool) {
      pool = { browsers: new Map(), states: new Map(), windows: new Map() };
      this.pools.set(runId, pool);
    }
    return pool;
  }

  /** The run's browser for these settings, launched on first use and again if it was closed or crashed. */
  private async pooledBrowser(pool: RunPool, s: AppSettings): Promise<Browser> {
    const key = `${s.browser}|${s.headless}|${s.slowMoMs}`;
    const existing = pool.browsers.get(key);
    if (existing) {
      const browser = await existing.catch(() => undefined);
      if (browser?.isConnected()) return browser;
    }
    // The promise is stored before it settles, so two cases starting together share one launch.
    const launching = this.launch(s);
    pool.browsers.set(key, launching);
    launching.catch(() => pool.browsers.delete(key));
    return launching;
  }

  /** The window a case runs in, as the run's mode provides it. */
  private async openWindow(
    job: CaseJob,
    settings: AppSettings,
    runId: string,
    mode: RunMode | undefined,
    state: StorageState | undefined,
  ): Promise<CaseWindow> {
    const options = (saved: StorageState | undefined) => ({
      baseURL: settings.appUrl,
      ...windowViewport(settings),
      ...(saved && { storageState: saved }),
    });

    if (mode !== 'clean' && mode !== 'shared') {
      // A fresh browser and context per case: no cookies, storage or pages shared with any other case.
      const browser = await this.launch(settings);
      try {
        const context = await browser.newContext(options(state));
        const page = await context.newPage();
        const close = () => browser.close().catch(() => undefined);
        return { context, page, signedInBefore: false, release: close, abort: () => void close() };
      } catch (e) {
        await browser.close().catch(() => undefined);
        throw e;
      }
    }

    const pool = this.pool(runId);
    const key = reuseKey(job, settings);
    const browser = await this.pooledBrowser(pool, settings);

    if (mode === 'clean') {
      const saved = pool.states.get(key);
      const context = await browser.newContext(options(saved ?? state));
      const page = await context.newPage();
      const close = () => context.close().catch(() => undefined);
      return {
        context,
        page,
        signedInBefore: saved !== undefined,
        release: async (discard) => {
          if (discard) pool.states.delete(key);
          await close();
        },
        abort: () => void close(),
      };
    }

    const kept = pool.windows.get(key);
    const reusable =
      kept !== undefined && !kept.page.isClosed() && browser.contexts().includes(kept.context);
    const win = reusable ? kept : await newWindow(browser, options(state));
    pool.windows.set(key, win);
    const close = () => win.context.close().catch(() => undefined);
    return {
      ...win,
      signedInBefore: reusable,
      release: async (discard) => {
        // The window stays open for the account's next case unless it broke or must not be reused.
        if (!discard && !win.page.isClosed()) return;
        if (pool.windows.get(key) === win) pool.windows.delete(key);
        await close();
      },
      abort: () => void close(),
    };
  }

  /**
   * See whether a window that signed in before is still signed in: open the app and wait for the signed-in sign.
   * False when it is not (expired, signed out by a case, terms to accept); the caller then signs in in full.
   */
  private async stillSignedIn(page: Page, cfg: SignInConfig): Promise<boolean> {
    try {
      await page.goto(cfg.baseUrl, { timeout: cfg.timeoutMs });
      await waitSignedIn(page, cfg, Math.min(cfg.timeoutMs, RESUME_CHECK_MS));
      return true;
    } catch {
      return false;
    }
  }

  private async launch(s: AppSettings): Promise<Browser> {
    const browser = await launchers[s.browser].launch({
      headless: s.headless,
      slowMo: s.slowMoMs,
      ...fullWindow(s),
    });
    this.open.add(browser);
    browser.on('disconnected', () => this.open.delete(browser));
    return browser;
  }

  /**
   * Open a visible browser on the app's login page and wait while a person signs in by hand (any SSO, any second
   * factor). Returns the browser session to save. The platform types nothing.
   */
  async captureSession(s: AppSettings, timeoutMs = MANUAL_SIGN_IN_MS): Promise<string> {
    const browser = await launchers[s.browser].launch({
      headless: false,
      ...fullWindow({ browser: s.browser, headless: false }),
    });
    this.open.add(browser);
    try {
      const context = await browser.newContext({ baseURL: s.appUrl, viewport: null });
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

  async execute(
    job: CaseJob,
    ctx: { runId: string; signal: AbortSignal; mode?: RunMode },
  ): Promise<CaseOutcome> {
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

    const win = await this.openWindow(job, settings, ctx.runId, ctx.mode, state);
    const { context, page } = win;
    const onAbort = () => win.abort();
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    const artifacts: string[] = [];
    let discard = true; // what was kept for the account's later cases is dropped unless this case gets past sign-in
    try {
      // Sign in BEFORE tracing starts: a trace records typed values, which would include the password.
      const steps: StepResult[] = [];
      const started = Date.now();
      const signInCfg = {
        ...settings.login,
        baseUrl: settings.appUrl,
        timeoutMs: settings.timeoutMs,
      };
      try {
        // A window that signed in before (`clean` or `shared` mode) only checks it still is; otherwise sign in in full.
        const reused =
          needsSignIn && win.signedInBefore && (await this.stillSignedIn(page, signInCfg));
        if (!reused) {
          await signIn(page, signInCfg, creds);
          // `clean`: keep the signed-in state so the account's next cases start from it instead of signing in again.
          if (needsSignIn && ctx.mode === 'clean') {
            const signedIn = await context.storageState().catch(() => undefined);
            if (signedIn) this.pool(ctx.runId).states.set(reuseKey(job, settings), signedIn);
          }
        }
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
      discard = false;

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
      await win.release(discard || ctx.signal.aborted);
    }
  }
}

/** A new window (browser context) with one page. */
async function newWindow(
  browser: Browser,
  options: Parameters<Browser['newContext']>[0],
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(options);
  return { context, page: await context.newPage() };
}
