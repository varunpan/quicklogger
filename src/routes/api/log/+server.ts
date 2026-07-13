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

interface IpBucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, IpBucket>();
let lastSweepAt = Date.now();

export function _resetRateLimitForTests() {
  buckets.clear();
  lastSweepAt = Date.now();
}

export function _bucketCountForTests(): number {
  return buckets.size;
}

function rateLimit(ip: string): boolean {
  const now = Date.now();
  // Opportunistic eviction: a bucket is only ever rewritten by its own IP, so
  // an IP that never returns would hold its expired bucket forever — an
  // unbounded map on a long-lived process. At most once per window, drop
  // every expired bucket. O(n) over the map, amortized to once a minute.
  if (now - lastSweepAt >= 60_000) {
    lastSweepAt = now;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt < now) buckets.delete(key);
    }
  }
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

  // Early Content-Length guard: with the transport's BODY_SIZE_LIMIT=Infinity,
  // `request.text()` buffers the whole body before the post-buffer length
  // check runs. Reject an advertised-oversized body up front; an absent or
  // lying header (chunked bodies) falls through to the authoritative
  // post-buffer check below.
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BATCH_BYTES) {
    return new Response(null, { status: 413 });
  }

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
    try {
      refererRoute = new URL(referer).pathname;
    } catch {
      /* ignore */
    }
  }

  for (const r of body.records) {
    if (!r || typeof r !== 'object')
      return json({ error: 'record must be object' }, { status: 400 });
    if (typeof r.msg !== 'string' || r.msg.length === 0)
      return json({ error: 'msg required' }, { status: 400 });
    if (!VALID_LEVELS.has(r.level)) return json({ error: 'invalid level' }, { status: 400 });
    if (JSON.stringify(r).length > MAX_RECORD_BYTES) continue;
    locals.logger[r.level](r.msg, {
      // Quarantine the client's ctx under one key so it can't collide with —
      // and overwrite — the per-request binding (`request_id`/`route`) or the
      // server-owned `source`/timestamp fields (review #32). Secret redaction
      // still recurses into it, so a nested `token` is redacted as before.
      client_ctx: r.ctx ?? {},
      source: 'client',
      user_agent: ua,
      referer_route: refererRoute,
      client_ts: r.ts
    });
  }
  return new Response(null, { status: 204 });
};
