import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSecretKey, SecretBox } from './secrets.js';

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('SecretBox', () => {
  const box = new SecretBox(crypto.randomBytes(32));

  it('round-trips text, including unicode and awkward characters', () => {
    for (const s of ['p@ss', 'Üñíçødé 🔐', '  spaces  ', 'a:b:c', 'x'.repeat(500)]) {
      expect(box.decrypt(box.encrypt(s))).toBe(s);
    }
  });

  it('never stores the plain text and uses a fresh IV for each value', () => {
    const a = box.encrypt('hunter2-password');
    const b = box.encrypt('hunter2-password');
    expect(a).not.toContain('hunter2');
    expect(a).not.toBe(b);
    expect(Buffer.from(a.split(':')[3]!, 'base64').toString('utf8')).not.toContain('hunter2');
  });

  it('refuses tampered values, malformed values and values written with another key', () => {
    const token = box.encrypt('secret');
    const parts = token.split(':');
    const flipped = Buffer.from(parts[3]!, 'base64');
    flipped[0] = flipped[0]! ^ 1;
    expect(
      box.decrypt([parts[0], parts[1], parts[2], flipped.toString('base64')].join(':')),
    ).toBeUndefined();
    expect(box.decrypt('not a token')).toBeUndefined();
    expect(box.decrypt('v1:a:b')).toBeUndefined();
    expect(new SecretBox(crypto.randomBytes(32)).decrypt(token)).toBeUndefined();
  });

  it('requires a 32-byte key', () => {
    expect(() => new SecretBox(Buffer.alloc(16))).toThrow(/32 bytes/);
  });
});

describe('loadSecretKey', () => {
  it('uses the environment key when given, and rejects a wrong-sized one', () => {
    const key = crypto.randomBytes(32);
    expect(
      loadSecretKey({ envKey: key.toString('base64'), keyFile: path.join(tmp(), 'k') }).equals(key),
    ).toBe(true);
    expect(() =>
      loadSecretKey({ envKey: Buffer.alloc(8).toString('base64'), keyFile: path.join(tmp(), 'k') }),
    ).toThrow(/32 bytes/);
  });

  it('creates a key file once and reuses it, so saved passwords stay readable across restarts', () => {
    const file = path.join(tmp(), 'nested', 'secret.key');
    const first = loadSecretKey({ keyFile: file });
    expect(fs.existsSync(file)).toBe(true);
    expect(loadSecretKey({ keyFile: file }).equals(first)).toBe(true);
    expect(
      new SecretBox(first).decrypt(new SecretBox(loadSecretKey({ keyFile: file })).encrypt('x')),
    ).toBe('x');
  });

  it('refuses a damaged key file instead of silently making a new one', () => {
    const file = path.join(tmp(), 'secret.key');
    fs.writeFileSync(file, 'garbage');
    expect(() => loadSecretKey({ keyFile: file })).toThrow(/not a valid 32-byte key/);
  });
});
