import { redact } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSink = (line: string) => void;

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(ctx: Record<string, unknown>): Logger;
}

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Structured JSON-lines logger. All context is redacted before it is written. */
export function createLogger(
  sink: LogSink,
  minLevel: LogLevel = 'info',
  base: Record<string, unknown> = {},
): Logger {
  const write = (level: LogLevel, msg: string, ctx?: Record<string, unknown>) => {
    if (ORDER[level] < ORDER[minLevel]) return;
    sink(JSON.stringify(redact({ time: new Date().toISOString(), level, msg, ...base, ...ctx })));
  };
  return {
    debug: (m, c) => write('debug', m, c),
    info: (m, c) => write('info', m, c),
    warn: (m, c) => write('warn', m, c),
    error: (m, c) => write('error', m, c),
    child: (ctx) => createLogger(sink, minLevel, { ...base, ...ctx }),
  };
}
