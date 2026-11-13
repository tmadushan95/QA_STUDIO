import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PREFIX = 'v1';

/**
 * Encrypts secrets (test account passwords) at rest with AES-256-GCM.
 * Each value gets its own random IV, and a tampered or wrong-key value fails to decrypt instead of returning garbage.
 */
export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('The secret key must be 32 bytes.');
  }

  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [
      PREFIX,
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      data.toString('base64'),
    ].join(':');
  }

  /** The plain text, or undefined when the value is malformed, was tampered with, or was written with another key. */
  decrypt(token: string): string | undefined {
    const [v, iv, tag, data] = token.split(':');
    if (v !== PREFIX || !iv || !tag || !data) return undefined;
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
      d.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
    } catch {
      return undefined;
    }
  }
}

export interface KeySource {
  /** QA_SECRET_KEY: 32 bytes, base64 encoded. Wins over the key file. */
  envKey?: string | undefined;
  /** Where to keep a generated key when none is provided. Created on first use. */
  keyFile: string;
}

/**
 * Find the encryption key: from the environment if set, otherwise from a key file next to the database
 * (created with owner-only permissions the first time). Losing the key means saved passwords must be re-entered.
 */
export function loadSecretKey(src: KeySource): Buffer {
  if (src.envKey) {
    const key = Buffer.from(src.envKey, 'base64');
    if (key.length !== 32) throw new Error('QA_SECRET_KEY must be 32 bytes, base64 encoded.');
    return key;
  }
  if (fs.existsSync(src.keyFile)) {
    const key = Buffer.from(fs.readFileSync(src.keyFile, 'utf8').trim(), 'base64');
    if (key.length !== 32)
      throw new Error(`The key file ${path.basename(src.keyFile)} is not a valid 32-byte key.`);
    return key;
  }
  fs.mkdirSync(path.dirname(src.keyFile), { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(src.keyFile, key.toString('base64'), { mode: 0o600, flag: 'wx' });
  return key;
}
