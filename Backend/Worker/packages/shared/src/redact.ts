const SENSITIVE_KEY =
  /^pass$|passw(or)?d|passphrase|secret|token|authorization|cookie|api[-_]?key|credential/i;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

export const REDACTED = '[REDACTED]';

/**
 * Deep-copy a value, masking sensitive keys and bearer/basic tokens inside strings.
 * `ancestors` holds only the objects on the current path, so an object that is merely referenced twice
 * (shared, not circular) is copied both times; only true cycles become "[Circular]".
 */
export function redact(value: unknown, ancestors = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return value.replace(BEARER, `$1 ${REDACTED}`);
  if (value === null || typeof value !== 'object') return value;
  if (ancestors.has(value)) return '[Circular]';
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((v) => redact(v, ancestors));
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) ? REDACTED : redact(v, ancestors),
      ]),
    );
  } finally {
    ancestors.delete(value);
  }
}
