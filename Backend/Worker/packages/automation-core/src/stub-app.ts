import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A tiny stand-in for the web app under test, for tests and demos only (it is not any real application and says nothing about one).
 * It supports the two sign-in styles the platform knows: a username/password form, and a Microsoft-style
 * popup (email step, password step, "Stay signed in?" prompt). After sign-in, pages greet the user by name,
 * so a test can tell which account a browser is signed in as.
 */
export interface StubApp {
  url: string;
  /** Usernames in the order they signed in successfully. */
  signIns: string[];
  /** Every sign-in attempt, successful or not, by username. */
  attempts: string[];
  close(): Promise<void>;
}

export interface StubOptions {
  users: Record<string, string>;
  flow: 'form' | 'microsoft' | 'none';
  /** Text of the single sign-on button (for example "Sign in with Company SSO"). */
  buttonText?: string;
  /** After the password, ask for a second factor instead of finishing (as an MFA policy would). */
  mfa?: boolean;
  /** After sign-in, show a Terms of Use dialog that must be accepted, as some apps do on first sign-in. */
  terms?: boolean;
}

const NAV = `<nav><a href="/dashboard">Dashboard</a> <a href="/projects">Projects</a></nav>`;
const page = (body: string) =>
  `<!doctype html><meta charset="utf-8"><title>Stub App</title>${body}`;

function cookieUser(req: http.IncomingMessage): string | undefined {
  const m = /(?:^|;\s*)qa_user=([^;]+)/.exec(req.headers.cookie ?? '');
  return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

const msPage = (mfa: boolean) =>
  page(`
<h1>Sign in</h1>
<div id="step1"><input name="loginfmt" type="email" placeholder="Email"><input type="submit" value="Next" id="next"></div>
<div id="step2" hidden><input name="passwd" type="password" placeholder="Password"><input type="submit" value="Sign in" id="go"></div>
<div id="stay" hidden><p>Stay signed in?</p><input type="button" id="idSIButton9" value="Yes"></div>
<p id="err" role="alert"></p>
<script>
  const $ = (s) => document.querySelector(s);
  let user = '';
  $('#next').onclick = () => { user = $('[name=loginfmt]').value; $('#step1').hidden = true; $('#step2').hidden = false; };
  $('#go').onclick = async () => {
    const r = await fetch('/ms/done', { method: 'POST', body: JSON.stringify({ u: user, p: $('[name=passwd]').value }) });
    if (r.ok && ${mfa}) { $('#step2').hidden = true; document.body.insertAdjacentHTML('beforeend', '<h2>Approve sign in request</h2><p>Open your Authenticator app.</p>'); return; }
    if (r.ok) { $('#step2').hidden = true; $('#stay').hidden = false; } else { $('#err').textContent = 'Your account or password is incorrect.'; }
  };
  $('#idSIButton9').onclick = () => { window.opener.location.href = '/dashboard'; window.close(); };
</script>`);

export function createStubApp(opts: StubOptions): Promise<StubApp> {
  const signIns: string[] = [];
  const attempts: string[] = [];
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '/';
    const send = (status: number, body: string, headers: Record<string, string> = {}) =>
      res.writeHead(status, { 'content-type': 'text/html', ...headers }).end(body);
    const user = opts.flow === 'none' ? 'guest' : cookieUser(req);

    if (url === '/login' && req.method === 'GET') {
      if (opts.flow === 'microsoft') {
        return send(
          200,
          page(
            `<h1>Stub App</h1><button onclick="window.open('/ms','ms','width=500,height=600')">${opts.buttonText ?? 'Sign in with Microsoft'}</button>`,
          ),
        );
      }
      return send(
        200,
        page(
          `<h1>Sign in</h1><form method="post" action="/login"><label>Username <input name="username" type="text"></label><label>Password <input name="password" type="password"></label><button type="submit">Sign in</button></form>`,
        ),
      );
    }
    if (url === '/login' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      const u = form.get('username') ?? '';
      attempts.push(u);
      if (opts.users[u] !== undefined && opts.users[u] === form.get('password')) {
        signIns.push(u);
        return send(302, '', {
          location: '/dashboard',
          'set-cookie': `qa_user=${encodeURIComponent(u)}; Path=/`,
        });
      }
      return send(401, page(`<h1>Sign in</h1><p role="alert">Invalid username or password.</p>`));
    }
    if (url === '/ms') return send(200, msPage(opts.mfa === true));
    if (url === '/ms/done' && req.method === 'POST') {
      const { u, p } = JSON.parse(await readBody(req)) as { u: string; p: string };
      attempts.push(u);
      if (opts.users[u] !== undefined && opts.users[u] === p) {
        signIns.push(u);
        return send(200, '{}', { 'set-cookie': `qa_user=${encodeURIComponent(u)}; Path=/` });
      }
      return send(401, '{}');
    }
    // Like the real app: the root opens the start page, which sends a visitor who is not signed in to /login.
    if (url === '/') return send(302, '', { location: '/dashboard' });
    if (url === '/dashboard') {
      return user
        ? send(
            200,
            page(
              `${NAV}<h1>Welcome back, ${user}</h1>${opts.terms ? '<div role="dialog" aria-label="Terms of Use"><h2>Terms of Use</h2><button>I Agree</button></div>' : ''}`,
            ),
          )
        : send(302, '', { location: '/login' });
    }
    if (url === '/projects') {
      return user
        ? send(200, page(`${NAV}<h1>Projects</h1><p>Signed in as ${user}</p>`))
        : send(302, '', { location: '/login' });
    }
    return send(404, page('<h1>Not found</h1>'));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        signIns,
        attempts,
        close: () => new Promise((r) => (server.closeAllConnections(), server.close(() => r()))),
      });
    });
  });
}
