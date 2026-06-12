import type { Writable } from 'node:stream';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';

const requireFromHere = createRequire(import.meta.url);

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
      // Spread ctx first, then set the canonical fields last, so a caller-
      // supplied `ts`/`level`/`msg` in `ctx` can't rewrite the real ones in the
      // persisted record (review #32). Untrusted callers (the /api/log forwarder)
      // additionally quarantine their ctx under `client_ctx` at the boundary.
      const rec: Record<string, unknown> = {
        ...safeCtx,
        ts: new Date().toISOString(),
        level,
        msg
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

export interface BootLoggerEnv {
  logLevel: LogLevel;
  logPretty: boolean;
  logFilePath: string | undefined;
  logFileMaxSizeMb: number;
  logFileMaxFiles: number;
  envWarnings: string[];
}

let _instance: Logger | null = null;
let _crashHandlersRegistered = false;

export function bootLogger(
  env: BootLoggerEnv,
  deps?: {
    openFileSink?: (path: string, sizeMb: number, maxFiles: number) => Writable;
    registerProcessHandlers?: boolean;
  }
): Logger {
  let fileSink: Writable | undefined;
  let fileError: string | undefined;
  if (env.logFilePath) {
    try {
      mkdirSync(dirname(env.logFilePath), { recursive: true });
      fileSink = (deps?.openFileSink ?? defaultOpenFileSink)(
        env.logFilePath,
        env.logFileMaxSizeMb,
        env.logFileMaxFiles
      );
    } catch (err) {
      fileError = `failed to open LOG_FILE_PATH ${env.logFilePath}: ${(err as Error).message}`;
    }
  }
  const logger = createLogger({
    level: env.logLevel,
    pretty: env.logPretty,
    fileStream: fileSink
  });

  logger.info('logger ready', {
    level: env.logLevel,
    pretty: env.logPretty,
    file_enabled: Boolean(fileSink),
    file_path: env.logFilePath,
    max_size_mb: env.logFilePath ? env.logFileMaxSizeMb : undefined,
    max_files: env.logFilePath ? env.logFileMaxFiles : undefined
  });

  for (const w of env.envWarnings) logger.warn('env validation', { detail: w });
  if (fileError) logger.warn('log file disabled', { detail: fileError });

  if (deps?.registerProcessHandlers !== false && !_crashHandlersRegistered) {
    registerCrashHandlers(logger);
    _crashHandlersRegistered = true;
  }

  _instance = logger;
  return logger;
}

export function getLogger(): Logger {
  if (!_instance) {
    // Fallback for tests that import a server module before bootLogger runs.
    _instance = createLogger({ level: 'info', pretty: false });
  }
  return _instance;
}

export function _resetLoggerForTests() {
  _instance = null;
  _crashHandlersRegistered = false;
}

function defaultOpenFileSink(path: string, sizeMb: number, maxFiles: number): Writable {
  // Lazy require via createRequire keeps rotating-file-stream out of bundles that don't need
  // it. Bare require() would crash here since this package is ESM ("type": "module").
  const rfs = requireFromHere('rotating-file-stream') as typeof import('rotating-file-stream');
  return rfs.createStream(path, {
    size: `${sizeMb}M`,
    maxFiles,
    initialRotation: false
  }) as unknown as Writable;
}

function registerCrashHandlers(logger: Logger): void {
  process.on('uncaughtException', (err) => {
    try {
      logger.error('uncaught exception', { err });
    } finally {
      setTimeout(() => process.exit(1), 100).unref();
    }
  });
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error('unhandled rejection', { err });
  });
}
