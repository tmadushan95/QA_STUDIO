#!/usr/bin/env node
/* global process, fetch, setTimeout */
/**
 * Starts QA Studio: the .NET API (the one address the browser uses) and the Node worker (Playwright, Excel, AI). Each
 * survives the other restarting; stopping this script stops both. Settings come from ../appsettings*.json and .env.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // No .env file: rely on the process environment.
}
const address = process.env.QA_PERSISTENCE_URL ?? 'http://127.0.0.1:5080';

// The API takes the same admin token as the worker, so they cannot disagree about who may do what.
const apiEnv = {
  ...process.env,
  ...(process.env.QA_INTERNAL_TOKEN && { Worker__InternalToken: process.env.QA_INTERNAL_TOKEN }),
  ...(process.env.QA_ADMIN_TOKEN && { Security__AdminToken: process.env.QA_ADMIN_TOKEN }),
};
const children = [
  spawn('dotnet', ['run', '--project', '../src/API'], {
    cwd: root,
    stdio: 'inherit',
    env: apiEnv,
  }),
  spawn(process.execPath, ['services/qa-api/dist/server.js'], { cwd: root, stdio: 'inherit' }),
];

// The voice agent is optional: it starts only when LiveKit is configured, and if it stops, the rest keeps running
// (voice then reports that it cannot connect).
const voice = process.env.QA_LIVEKIT_URL
  ? spawn(process.execPath, ['services/qa-voice/dist/server.js', 'start'], {
      cwd: root,
      stdio: 'inherit',
    })
  : undefined;
voice?.once('exit', (code) => {
  if (!stopping)
    process.stderr.write(
      `The voice agent stopped (code ${code}). Voice is unavailable until restart.\n`,
    );
});

let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  voice?.kill();
  for (const child of children) child.kill();
  process.exitCode = code;
};
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
for (const child of children) {
  child.once('exit', (code) => {
    if (!stopping)
      process.stderr.write(`A QA Studio process stopped (code ${code}). Stopping the other.\n`);
    stop(code ?? 1);
  });
}

if (process.env.QA_OPEN_BROWSER === 'true') {
  const health = `${address}/api/health`;
  for (let i = 0; i < 90; i++) {
    const up = await fetch(health).then(
      (r) => r.ok,
      () => false,
    );
    if (up) {
      const [cmd, args] =
        process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', address]]
          : process.platform === 'darwin'
            ? ['open', [address]]
            : ['xdg-open', [address]];
      spawn(cmd, args, { detached: true, stdio: 'ignore' })
        .on('error', () => undefined)
        .unref();
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
