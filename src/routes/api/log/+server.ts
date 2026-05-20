import { json, type RequestHandler } from '@sveltejs/kit';

type ClientLevel = 'debug' | 'info' | 'warn' | 'error';
const VALID_LEVELS: ReadonlySet<ClientLevel> = new Set(['debug', 'info', 'warn', 'error']);

interface ClientRecord {
  level: ClientLevel;
  msg: string;
  ts: string;
  ctx?: Record<string, unknown>;
}

const MAX_RECORDS = 20;
const MAX_BATCH_BYTES = 100 * 1024;
const MAX_RECORD_BYTES = 8 * 1024;
const RATE_PER_MIN = 60;

interface IpBucket { count: number; resetAt: number; }
const buckets = new Map<string, IpBucket>();

export function _resetRateLimitForTests() {
  buckets.clear();
}

function rateLimit(ip: string): boolean {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || b.resetAt < now) {
    b = { count: 0, resetAt: now + 60_000 };
    buckets.set(ip, b);
  }
  b.count++;
  return b.count <= RATE_PER_MIN;
}

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
  const ip = getClientAddress();
  if (!rateLimit(ip)) return new Response(null, { status: 429 });

  const raw = await request.text();
  if (raw.length > MAX_BATCH_BYTES) {
    return new Response(null, { status: 413 });
  }
  let body: { records?: ClientRecord[] };
  try {
    body = JSON.parse(raw) as { records?: ClientRecord[] };
  } catch {
    return json({ error: 'invalid json' }, { status: 400 });
  }
  if (!Array.isArray(body.records)) {
    return json({ error: 'records[] required' }, { status: 400 });
  }
  if (body.records.length > MAX_RECORDS) {
    return new Response(null, { status: 413 });
  }

  const ua = request.headers.get('user-agent') ?? null;
  const referer = request.headers.get('referer');
  let refererRoute: string | null = null;
  if (referer) {
    try { refererRoute = new URL(referer).pathname; } catch { /* ignore */ }
  }

  for (const r of body.records) {
    if (!r || typeof r !== 'object') return json({ error: 'record must be object' }, { status: 400 });
    if (typeof r.msg !== 'string' || r.msg.length === 0) return json({ error: 'msg required' }, { status: 400 });
    if (!VALID_LEVELS.has(r.level)) return json({ error: 'invalid level' }, { status: 400 });
    if (JSON.stringify(r).length > MAX_RECORD_BYTES) continue;
    locals.logger[r.level](r.msg, {
      ...(r.ctx ?? {}),
      source: 'client',
      user_agent: ua,
      referer_route: refererRoute,
      client_ts: r.ts
    });
  }
  return new Response(null, { status: 204 });
};
