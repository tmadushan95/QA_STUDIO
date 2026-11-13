import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createStubApp,
  signIn,
  SignInError,
  waitForManualSignIn,
  type SignInConfig,
  type StubApp,
} from './index.js';

const USERS = { alice: 'Alice-pw-123', bob: 'Bob-pw-456' };
let browser: Browser;
let form: StubApp;
let ms: StubApp;

beforeAll(async () => {
  form = await createStubApp({ users: USERS, flow: 'form' });
  ms = await createStubApp({ users: USERS, flow: 'microsoft' });
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await form?.close();
  await ms?.close();
});

const cfg = (
  app: StubApp,
  strategy: SignInConfig['strategy'],
  over: Partial<SignInConfig> = {},
): SignInConfig => ({
  strategy,
  path: '/login',
  signedInMarker: 'Welcome back,',
  baseUrl: app.url,
  timeoutMs: 3000,
  ...over,
});

/** Start waiting for a manual sign-in, then play the person's part, as "Sign in by hand" does. */
async function waitForManualSignInWhile(
  page: import('playwright').Page,
  person: () => Promise<void>,
) {
  const waiting = waitForManualSignIn(page, cfg(form, 'login-form'), 10_000);
  await page.getByLabel('Username').waitFor();
  await person();
  await waiting;
}

async function withPage<T>(fn: (page: import('playwright').Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext();
  try {
    return await fn(await context.newPage());
  } finally {
    await context.close();
  }
}

describe('signIn', () => {
  it('signs in through a username/password form and lands on a page that greets the account', async () => {
    await withPage(async (page) => {
      await signIn(page, cfg(form, 'login-form'), { username: 'alice', password: USERS.alice });
      expect(await page.getByText('Welcome back, alice').isVisible()).toBe(true);
    });
  }, 30_000);

  it('signs in through a Microsoft-style popup, including the "Stay signed in?" prompt', async () => {
    await withPage(async (page) => {
      await signIn(page, cfg(ms, 'microsoft-sso'), { username: 'bob', password: USERS.bob });
      expect(await page.getByText('Welcome back, bob').isVisible()).toBe(true);
    });
  }, 30_000);

  it('two accounts in two separate browsers stay independent', async () => {
    const [a, b] = await Promise.all(
      (['alice', 'bob'] as const).map((u) =>
        withPage(async (page) => {
          await signIn(page, cfg(form, 'login-form'), { username: u, password: USERS[u] });
          await page.goto(`${form.url}/projects`);
          return page.getByText(/Signed in as/).innerText();
        }),
      ),
    );
    expect([a, b]).toEqual(['Signed in as alice', 'Signed in as bob']);
  }, 30_000);

  it('with no sign-in method it just opens the app', async () => {
    const open = await createStubApp({ users: {}, flow: 'none' });
    try {
      await withPage(async (page) => {
        await signIn(page, cfg(open, 'none'), { username: '', password: '' });
        await page.goto(`${open.url}/dashboard`);
        expect(await page.getByText('Welcome back, guest').isVisible()).toBe(true);
      });
    } finally {
      await open.close();
    }
  }, 30_000);

  it('fails clearly on a wrong password, and the message never contains the credentials', async () => {
    const creds = { username: 'alice', password: 'Wrong-pw-999' };
    for (const [app, strategy] of [
      [form, 'login-form'],
      [ms, 'microsoft-sso'],
    ] as const) {
      await withPage(async (page) => {
        const err = await signIn(page, cfg(app, strategy), creds).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(SignInError);
        const msg = (err as Error).message;
        expect(msg).toMatch(/did not appear|did not accept the password/);
        if (app === ms) expect(msg).toContain('Your account or password is incorrect.');
        expect(msg).not.toMatch(/^Signed in/); // a failed sign-in must not claim to have signed in
        if (app === form) expect(msg).toContain('The page said: "Invalid username or password."');
        expect(msg).not.toContain('Wrong-pw-999');
        expect(msg).not.toContain('alice');
      });
    }
  }, 60_000);

  it('points at the settings when the signed-in text is wrong', async () => {
    await withPage(async (page) => {
      const err = await signIn(
        page,
        cfg(form, 'login-form', { signedInMarker: 'No such greeting' }),
        { username: 'alice', password: USERS.alice },
      ).catch((e: Error) => e);
      expect((err as Error).message).toMatch(/"No such greeting" did not appear.*Settings/);
    });
  }, 30_000);

  it('signs in through an app-branded "Sign in with Company SSO" button', async () => {
    const ssoApp = await createStubApp({
      users: USERS,
      flow: 'microsoft',
      buttonText: 'Sign in with Company SSO',
    });
    try {
      await withPage(async (page) => {
        await signIn(page, cfg(ssoApp, 'microsoft-sso'), { username: 'bob', password: USERS.bob });
        expect(await page.getByText('Welcome back, bob').isVisible()).toBe(true);
      });
    } finally {
      await ssoApp.close();
    }
  }, 30_000);

  it('without a signed-in text, leaving the login page counts as signed in', async () => {
    await withPage(async (page) => {
      await signIn(page, cfg(form, 'login-form', { signedInMarker: '' }), {
        username: 'alice',
        password: USERS.alice,
      });
      expect(page.url()).toBe(`${form.url}/dashboard`);
    });
  }, 30_000);

  it('says which step failed when there is no sign-in button, instead of a raw timeout', async () => {
    await withPage(async (page) => {
      const err = await signIn(page, cfg(form, 'microsoft-sso'), {
        username: 'bob',
        password: USERS.bob,
      }).catch((e: Error) => e);
      expect(err).toBeInstanceOf(SignInError);
      expect((err as Error).message).toContain(
        'Finding the "Sign in with …" button on the login page',
      );
      expect((err as Error).message).not.toContain('locator.click');
    });
  }, 30_000);

  it('stops with a clear way round when the organisation asks for a second factor', async () => {
    const mfa = await createStubApp({ users: USERS, flow: 'microsoft', mfa: true });
    try {
      await withPage(async (page) => {
        const err = await signIn(page, cfg(mfa, 'microsoft-sso', { timeoutMs: 8000 }), {
          username: 'bob',
          password: USERS.bob,
        }).catch((e: Error) => e);
        expect((err as Error).message).toMatch(/second step.*Saved session/);
      });
    } finally {
      await mfa.close();
    }
  }, 30_000);

  it("never accepts Terms of Use on anyone's behalf, and says what to do", async () => {
    const terms = await createStubApp({ users: USERS, flow: 'form', terms: true });
    try {
      await withPage(async (page) => {
        const err = await signIn(page, cfg(terms, 'login-form'), {
          username: 'alice',
          password: USERS.alice,
        }).catch((e: Error) => e);
        expect((err as Error).message).toMatch(/Terms of Use.*"I Agree"/);
        expect(await page.getByRole('dialog').isVisible()).toBe(true); // still open: nothing was clicked
      });
    } finally {
      await terms.close();
    }
  }, 30_000);

  it('reuses a saved session, and says when it no longer works', async () => {
    // Sign in once (as a person would by hand), keep the session, then use it in a fresh browser.
    const context = await browser.newContext();
    const page = await context.newPage();
    await waitForManualSignInWhile(page, async () => {
      await page.getByLabel('Username').fill('alice');
      await page.getByLabel('Password').fill(USERS.alice);
      await page.getByRole('button', { name: 'Sign in' }).click();
    });
    const state = await context.storageState();
    await context.close();

    const reuse = await browser.newContext({ storageState: state });
    try {
      const p = await reuse.newPage();
      await signIn(p, cfg(form, 'saved-session'), { username: '', password: '' });
      expect(await p.getByText('Welcome back, alice').isVisible()).toBe(true);
    } finally {
      await reuse.close();
    }

    await withPage(async (p) => {
      const err = await signIn(p, cfg(form, 'saved-session', { timeoutMs: 3000 }), {
        username: '',
        password: '',
      }).catch((e: Error) => e);
      expect((err as Error).message).toMatch(
        /saved session for this account no longer works.*Sign in by hand/,
      );
    });
  }, 60_000);

  it('scrubs credentials that appear inside underlying error text', async () => {
    await withPage(async (page) => {
      await page.close();
      // A closed page makes Playwright throw; whatever it says must not carry the secrets.
      const err = await signIn(page, cfg(form, 'login-form'), {
        username: 'alice-user',
        password: 'S3cret-value',
      }).catch((e: Error) => e);
      expect(err).toBeInstanceOf(SignInError);
      expect((err as Error).message).not.toMatch(/S3cret-value|alice-user/);
    });
  }, 30_000);
});
