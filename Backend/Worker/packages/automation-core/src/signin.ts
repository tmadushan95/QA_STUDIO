import type { Locator, Page } from 'playwright';
import type { LoginStrategy } from '@qa-studio/shared';

export interface Credentials {
  username: string;
  password: string;
}

export interface SignInConfig {
  strategy: LoginStrategy;
  /** Same-site login path, such as /login. */
  path: string;
  /** Text that appears once signed in. Optional: leaving the login page also counts as signed in. */
  signedInMarker: string;
  baseUrl: string;
  timeoutMs: number;
}

/** A sign-in that did not complete. The message is safe to show: it never contains the credentials. */
export class SignInError extends Error {
  override name = 'SignInError';
}

/** Remove the credentials from any text before it can reach a log, report or screen. */
function scrub(text: string, creds: Credentials): string {
  let out = text;
  for (const secret of [creds.password, creds.username]) {
    if (secret.length >= 3) out = out.split(secret).join('[hidden]');
  }
  return out;
}

/** Run one step of the sign-in; if it fails, say which step in plain words instead of a raw Playwright message. */
async function step<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SignInError) throw e;
    const timedOut = e instanceof Error && e.name === 'TimeoutError';
    throw new SignInError(
      timedOut
        ? `${what}: nothing happened in time.`
        : `${what}: ${e instanceof Error ? e.message.split('\n')[0] : 'failed'}.`,
    );
  }
}

/** The app's own "Sign in with …" button (for example "Sign in with Company SSO"). */
const ssoButton = (page: Page): Locator =>
  page
    .getByRole('button', { name: /sign in with|log in with|continue with|single sign-on|\bSSO\b/i })
    .first();

/** Wording identity providers use when they ask for a second factor. A script cannot answer these. */
const MFA_TEXT =
  /approve sign[- ]?in|verify your identity|enter (the )?code|authenticator|text message|we sent|security key|more information required|use your phone/i;

const visibleText = async (page: Page): Promise<string> =>
  page
    .locator('body')
    .innerText({ timeout: 1000 })
    .then(
      (s) => s.replace(/\s+/g, ' '),
      () => '',
    );

function loginPath(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return url;
  }
}

/**
 * Wait until the app shows it is signed in: the configured text appears, or the browser has left the login page and
 * no sign-in button is showing. Stops early, with a clear reason, if the app shows its Terms of Use.
 */
export async function waitSignedIn(
  page: Page,
  cfg: SignInConfig,
  timeoutMs = cfg.timeoutMs,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const marker = cfg.signedInMarker.trim();
  const login = loginPath(new URL(cfg.path, cfg.baseUrl).toString());
  while (Date.now() < deadline) {
    if (page.isClosed())
      throw new SignInError('The browser window was closed before sign-in finished.');
    // Checked first: the app may already show signed-in text behind the dialog.
    const terms = page
      .getByRole('dialog')
      .filter({ hasText: /terms of use/i })
      .first();
    if (await terms.isVisible().catch(() => false)) {
      throw new SignInError(
        'The app asks this account to accept its Terms of Use. Sign in once by hand as this account, click "I Agree", then try again. The platform does not accept terms on anyone\'s behalf.',
      );
    }
    // A signed-in text set in Settings is the rule; without one, leaving the login page counts.
    if (marker) {
      if (
        await page
          .getByText(marker, { exact: false })
          .first()
          .isVisible()
          .catch(() => false)
      )
        return;
      await page.waitForTimeout(500);
      continue;
    }
    const away = loginPath(page.url()) !== login;
    if (
      away &&
      !(await ssoButton(page)
        .isVisible()
        .catch(() => false))
    ) {
      // Give a single-page app a moment to redirect back to the login page if the session is not really valid.
      await page.waitForTimeout(1500);
      if (
        loginPath(page.url()) !== login &&
        !(await ssoButton(page)
          .isVisible()
          .catch(() => false))
      )
        return;
    }
    await page.waitForTimeout(500);
  }
  const said = await page
    .getByRole('alert')
    .first()
    .innerText({ timeout: 500 })
    .then(
      (s) => s.replace(/\s+/g, ' ').trim().slice(0, 200),
      () => '',
    );
  throw new SignInError(
    `Sign-in did not finish: the browser is on ${page.url()}${marker ? ` and "${marker}" did not appear` : ''}.${said ? ` The page said: "${said}".` : ''} Check the username and password, and the sign-in method, login page path and signed-in text in Settings${marker ? ' (the signed-in text can be left empty)' : ''}.`,
  );
}

async function signInWithForm(page: Page, cfg: SignInConfig, creds: Credentials): Promise<void> {
  const t = cfg.timeoutMs;
  await step(`Opening the login page ${cfg.path}`, () =>
    page.goto(new URL(cfg.path, cfg.baseUrl).toString(), { timeout: t }),
  );
  const user = page
    .locator(
      'input[type=email], input[autocomplete=username], input[name*=user i], input[name*=email i], input[id*=user i], input[id*=email i], input[type=text]',
    )
    .first();
  const pass = page.locator('input[type=password]').first();
  await step('Filling in the username (no username field was found on the login page)', () =>
    user.fill(creds.username, { timeout: t }),
  );
  // Some apps ask for the password on a second screen.
  if (!(await pass.isVisible())) {
    await step('Going to the password screen ("Next" or "Continue" button)', () =>
      page
        .getByRole('button', { name: /next|continue/i })
        .first()
        .click({ timeout: t }),
    );
    await step('Waiting for the password field', () =>
      pass.waitFor({ state: 'visible', timeout: t }),
    );
  }
  await step('Filling in the password', () => pass.fill(creds.password, { timeout: t }));
  const submit = page.getByRole('button', { name: /sign in|log in|login|submit/i }).first();
  await step('Clicking the sign-in button', async () =>
    ((await submit.count()) > 0 ? submit : page.locator('[type=submit]').first()).click({
      timeout: t,
    }),
  );
  await waitSignedIn(page, cfg);
}

/**
 * The single sign-on flow: the app's "Sign in with … SSO" button opens a Microsoft popup (email, then password, then maybe
 * "Stay signed in?"). If the organisation sends the popup to its own sign-in page, a password field there is filled
 * too. A second factor (MFA) cannot be scripted: that is reported clearly, with the way round it.
 */
async function signInWithMicrosoft(
  page: Page,
  cfg: SignInConfig,
  creds: Credentials,
): Promise<void> {
  const t = cfg.timeoutMs;
  const short = Math.min(t, 15_000);
  await step(`Opening the login page ${cfg.path}`, () =>
    page.goto(new URL(cfg.path, cfg.baseUrl).toString(), { timeout: t }),
  );

  // Already signed in (a session that is still valid) — nothing to do.
  if (
    !(await ssoButton(page)
      .isVisible({ timeout: 3000 })
      .catch(() => false))
  ) {
    const legacy = page.getByText('Sign in with Microsoft').first();
    if (!(await legacy.isVisible().catch(() => false))) {
      await step(
        'Finding the "Sign in with …" button on the login page (check the app address and login page path in Settings)',
        () => ssoButton(page).waitFor({ state: 'visible', timeout: short }),
      );
    }
  }
  const button = (await ssoButton(page)
    .isVisible()
    .catch(() => false))
    ? ssoButton(page)
    : page.getByText('Sign in with Microsoft').first();

  const popupPromise = page.waitForEvent('popup', { timeout: t });
  await step('Clicking the sign-in button', () => button.click({ timeout: short }));
  const popup = await step(
    'Waiting for the Microsoft sign-in window (a popup blocker may have stopped it)',
    () => popupPromise,
  );
  await popup.waitForLoadState('domcontentloaded', { timeout: t }).catch(() => undefined);

  const email = popup.locator("input[name='loginfmt'], input[type='email']").first();
  await step('Filling in the email address in the Microsoft window', () =>
    email.fill(creds.username, { timeout: t }),
  );
  await step('Clicking "Next" in the Microsoft window', () =>
    popup
      .locator("input[type='submit']:visible, button[type='submit']:visible")
      .first()
      .click({ timeout: short }),
  );

  // Next comes a password field: Microsoft's own, or the organisation's sign-in page (federated SSO).
  const password = popup.locator("input[name='passwd'], input[type='password']").first();
  const deadline = Date.now() + t;
  while (Date.now() < deadline) {
    if (popup.isClosed()) break; // signed in without a password (an existing session)
    if (await password.isVisible().catch(() => false)) break;
    const text = await visibleText(popup);
    if (MFA_TEXT.test(text)) throw mfaError();
    const error = popup.locator('#usernameError, [role=alert]').first();
    if (await error.isVisible().catch(() => false)) {
      throw new SignInError(
        `Microsoft did not accept the email address: "${(await error.innerText()).trim().slice(0, 200)}".`,
      );
    }
    await popup.waitForTimeout(500).catch(() => undefined);
  }
  if (!popup.isClosed()) {
    if (!(await password.isVisible().catch(() => false))) {
      throw new SignInError(
        `No password field appeared after the email address (the window is on ${new URL(popup.url()).host}). Your organisation's sign-in page may need something a script cannot do. Use the "Saved session" sign-in method instead.`,
      );
    }
    await step('Filling in the password', () => password.fill(creds.password, { timeout: t }));
    await step('Clicking "Sign in"', () =>
      popup
        .locator("input[type='submit']:visible, button[type='submit']:visible")
        .first()
        .click({ timeout: short }),
    );
    // "Stay signed in?" is optional; the popup may also close on its own, or ask for a second factor.
    const end = Date.now() + Math.min(t, 30_000);
    while (!popup.isClosed() && Date.now() < end) {
      const stay = popup.locator('input#idSIButton9, #idSIButton9').first();
      if (await stay.isVisible().catch(() => false)) {
        await stay.click({ timeout: 5000 }).catch(() => undefined);
        continue;
      }
      const text = await visibleText(popup);
      if (MFA_TEXT.test(text)) throw mfaError();
      const bad = popup.locator('#passwordError, [role=alert]').first();
      if (await bad.isVisible().catch(() => false)) {
        throw new SignInError(
          `The sign-in page did not accept the password: "${(await bad.innerText()).trim().slice(0, 200)}".`,
        );
      }
      await popup.waitForTimeout(500).catch(() => undefined);
    }
  }
  await waitSignedIn(page, cfg);
}

function mfaError(): SignInError {
  return new SignInError(
    'The sign-in asks for a second step (for example an Authenticator approval or a code). A script cannot do that. Use the "Saved session" sign-in method: sign in once by hand in Settings, and the tests reuse that session.',
  );
}

/**
 * Sign a browser page in with the given account. Credentials are used only here, are never logged, and any
 * error text is scrubbed of them. Do not start tracing before calling this: a trace records typed values.
 * For "saved-session" the page's context must already hold the saved session; this only checks it still works.
 */
export async function signIn(page: Page, cfg: SignInConfig, creds: Credentials): Promise<void> {
  if (cfg.strategy === 'none') {
    await page.goto(cfg.baseUrl, { timeout: cfg.timeoutMs });
    return;
  }
  try {
    if (cfg.strategy === 'saved-session') {
      await step('Opening the app with the saved session', () =>
        page.goto(cfg.baseUrl, { timeout: cfg.timeoutMs }),
      );
      try {
        await waitSignedIn(page, cfg, Math.min(cfg.timeoutMs, 30_000));
      } catch (e) {
        if (e instanceof SignInError && /Terms of Use/.test(e.message)) throw e;
        throw new SignInError(
          'The saved session for this account no longer works (it expired or was signed out). In Settings, use "Sign in by hand" for this account again.',
        );
      }
    } else if (cfg.strategy === 'login-form') await signInWithForm(page, cfg, creds);
    else await signInWithMicrosoft(page, cfg, creds);
  } catch (e) {
    if (e instanceof SignInError) throw new SignInError(scrub(e.message, creds));
    const first =
      e instanceof Error ? (e.message.split('\n')[0] ?? 'unknown error') : 'unknown error';
    throw new SignInError(`Could not complete sign-in: ${scrub(first, creds)}`);
  }
}

/**
 * Let a person sign in by hand in a visible window (any SSO, any second factor), and return when the app shows it is
 * signed in. The caller then saves the session. Nothing is typed by the platform.
 */
export async function waitForManualSignIn(
  page: Page,
  cfg: SignInConfig,
  timeoutMs: number,
): Promise<void> {
  await page.goto(new URL(cfg.path, cfg.baseUrl).toString(), { timeout: cfg.timeoutMs });
  try {
    await waitSignedIn(page, cfg, timeoutMs);
  } catch (e) {
    if (e instanceof SignInError && /closed/.test(e.message)) throw e;
    if (e instanceof SignInError && /Terms of Use/.test(e.message)) {
      // A person is at the window: let them accept the terms themselves, then keep waiting.
      await page
        .getByRole('dialog')
        .filter({ hasText: /terms of use/i })
        .first()
        .waitFor({ state: 'hidden', timeout: timeoutMs })
        .catch(() => undefined);
      return waitSignedIn(page, cfg, timeoutMs);
    }
    throw new SignInError(
      `Sign-in by hand did not finish within ${Math.round(timeoutMs / 60000)} minutes.`,
    );
  }
}
