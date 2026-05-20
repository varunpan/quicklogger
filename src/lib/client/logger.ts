type Level = 'debug' | 'info' | 'warn' | 'error';
interface Record_ { level: Level; msg: string; ts: string; ctx?: Record<string, unknown>; }

const SECRET_KEY_RE = /(api[_-]?key|token|secret|password|authorization)/i;
const MAX_BUFFER = 20;
const MAX_RECORD_BYTES = 4 * 1024;
const SIZE_FLUSH_THRESHOLD = 10;
const TIME_FLUSH_MS = 10_000;
const MAX_BACKOFF_MS = 60_000;

let buffer: Record_[] = [];
let lastRequestId: string | undefined;
let backoffMs = TIME_FLUSH_MS;
let timer: ReturnType<typeof setTimeout> | null = null;
let installed = false;
let sizeFlushQueued = false;

function redact(input: unknown, depth = 0): unknown {
  if (depth >= 5) return '[truncated]';
  if (input === null || input === undefined) return input;
  if (typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = SECRET_KEY_RE.test(k) ? '***' : redact(v, depth + 1);
  }
  return out;
}

function push(level: Level, msg: string, ctx?: Record<string, unknown>) {
  const safeCtx = redact(ctx ?? {}) as Record<string, unknown>;
  if (lastRequestId) safeCtx.request_id = lastRequestId;
  const rec: Record_ = { level, msg, ts: new Date().toISOString(), ctx: safeCtx };
  const recBytes = JSON.stringify(rec).length;
  if (recBytes > MAX_RECORD_BYTES) {
    rec.ctx = { _truncated: true, request_id: safeCtx.request_id };
  }
  buffer.push(rec);
  while (buffer.length > MAX_BUFFER) buffer.shift();
  if (buffer.length >= SIZE_FLUSH_THRESHOLD && !sizeFlushQueued) {
    sizeFlushQueued = true;
    queueMicrotask(() => {
      sizeFlushQueued = false;
      void flush();
    });
  }
  scheduleFlush();
}

function scheduleFlush() {
  if (timer || buffer.length === 0) return;
  timer = setTimeout(() => { timer = null; void flush(); }, backoffMs);
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const records = buffer.splice(0, buffer.length);
  try {
    const res = await fetch('/api/log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ records })
    });
    captureRequestId(res);
    if (res.status >= 500) {
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      buffer = [...records, ...buffer];
    } else {
      backoffMs = TIME_FLUSH_MS;
    }
  } catch {
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    buffer = [...records, ...buffer];
  }
}

function captureRequestId(res: Response) {
  const id = res.headers.get('x-request-id');
  if (id) lastRequestId = id;
}

export const clientLogger = {
  debug(msg: string, ctx?: Record<string, unknown>) { push('debug', msg, ctx); },
  info(msg: string, ctx?: Record<string, unknown>) { push('info', msg, ctx); },
  warn(msg: string, ctx?: Record<string, unknown>) { push('warn', msg, ctx); },
  error(msg: string, ctx?: Record<string, unknown>) { push('error', msg, ctx); }
};

export function installClientLogger() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await origFetch(...args);
    captureRequestId(res);
    return res;
  };
  window.addEventListener('error', (e) => {
    clientLogger.error('window error', {
      message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno
    });
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const reason = e.reason instanceof Error
      ? { message: e.reason.message, name: e.reason.name }
      : { reason: String(e.reason) };
    clientLogger.error('unhandled rejection', reason);
  });
  window.addEventListener('beforeunload', () => {
    if (buffer.length === 0) return;
    try {
      const records = buffer.splice(0, buffer.length);
      const blob = new Blob([JSON.stringify({ records })], { type: 'application/json' });
      navigator.sendBeacon('/api/log', blob);
    } catch { /* ignore */ }
  });
}

export function _resetClientLoggerForTests() {
  buffer = [];
  lastRequestId = undefined;
  backoffMs = TIME_FLUSH_MS;
  if (timer) clearTimeout(timer);
  timer = null;
  installed = false;
  sizeFlushQueued = false;
}

export function _bufferForTests() {
  return buffer;
}
