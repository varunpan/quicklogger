import type { Writable } from 'node:stream';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_KEY_RE = /(api[_-]?key|token|secret|password|authorization)/i;
const MAX_DEPTH = 5;
const REDACTED = '***';

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(ctx: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level: LogLevel;
  pretty: boolean;
  stdout?: Writable;
  fileStream?: Writable;
}

function redact(input: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (input === null || input === undefined) return input;
  if (input instanceof Error) {
    return { message: input.message, stack: input.stack, name: input.name };
  }
  const t = typeof input;
  if (t === 'function' || t === 'symbol') return undefined;
  if (t === 'bigint') return (input as bigint).toString();
  if (t !== 'object') return input;
  if (seen.has(input as object)) return '[cycle]';
  seen.add(input as object);
  if (Array.isArray(input)) return input.map((v) => redact(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) {
      out[k] = REDACTED;
    } else {
      out[k] = redact(v, depth + 1, seen);
    }
  }
  return out;
}

function safeStringify(rec: Record<string, unknown>): string {
  try {
    return JSON.stringify(rec);
  } catch {
    return JSON.stringify({ ts: rec.ts, level: rec.level, msg: '[serialization failed]' });
  }
}

function prettyFormat(rec: Record<string, unknown>): string {
  const { ts, level, msg, ...rest } = rec as {
    ts: string; level: string; msg: string; [k: string]: unknown;
  };
  const tsShort = String(ts).slice(11, 23); // HH:MM:SS.mmm
  const levelUp = level.toUpperCase();
  const pairs = Object.entries(rest)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  return `${tsShort} ${levelUp} ${msg}${pairs ? ' ' + pairs : ''}`;
}

export function createLogger(opts: LoggerOptions): Logger {
  const sinks = {
    stdout: opts.stdout ?? process.stdout,
    file: opts.fileStream
  };
  const thresholdNum = LEVEL_ORDER[opts.level];

  function emitRecord(rec: Record<string, unknown>) {
    const stdoutLine = opts.pretty ? prettyFormat(rec) : safeStringify(rec);
    sinks.stdout.write(stdoutLine + '\n');
    if (sinks.file) sinks.file.write(safeStringify(rec) + '\n');
  }

  function makeBase(baseCtx: Record<string, unknown>): Logger {
    function log(level: LogLevel, msg: string, ctx?: Record<string, unknown>) {
      if (LEVEL_ORDER[level] < thresholdNum) return;
      const merged: Record<string, unknown> = { ...baseCtx, ...(ctx ?? {}) };
      const safeCtx = redact(merged, 0, new WeakSet()) as Record<string, unknown>;
      const rec: Record<string, unknown> = {
        ts: new Date().toISOString(),
        level,
        msg,
        ...safeCtx
      };
      emitRecord(rec);
    }
    return {
      debug: (m, c) => log('debug', m, c),
      info: (m, c) => log('info', m, c),
      warn: (m, c) => log('warn', m, c),
      error: (m, c) => log('error', m, c),
      child: (c) => makeBase({ ...baseCtx, ...c })
    };
  }

  return makeBase({});
}
