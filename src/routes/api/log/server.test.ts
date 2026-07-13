import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST, _resetRateLimitForTests, _bucketCountForTests } from './+server';

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child() {
    return this;
  }
} as import('$lib/server/logger').Logger;

function makeEvent(
  body: unknown,
  headers: Record<string, string> = {},
  logger: import('$lib/server/logger').Logger = noopLogger,
  ip = '127.0.0.1'
): import('@sveltejs/kit').RequestEvent {
  return {
    request: new Request('http://localhost/api/log', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    }),
    locals: { logger, requestId: 't' },
    getClientAddress: () => ip,
    url: new URL('http://localhost/api/log'),
    route: { id: '/api/log' }
  } as unknown as import('@sveltejs/kit').RequestEvent;
}

describe('POST /api/log', () => {
  beforeEach(() => _resetRateLimitForTests());

  it('returns 204 on happy path', async () => {
    const res = await POST(
      makeEvent({
        records: [{ level: 'info', msg: 'hi', ts: new Date().toISOString() }]
      })
    );
    expect(res.status).toBe(204);
  });

  it('rejects missing records array', async () => {
    const res = await POST(makeEvent({}));
    expect(res.status).toBe(400);
  });

  it('rejects an oversized Content-Length with 413 before buffering the body', async () => {
    // 200 KiB advertised > the 100 KiB batch cap. The body itself is tiny —
    // the guard must fire from the header alone, before request.text().
    const res = await POST(
      makeEvent(
        { records: [{ level: 'info', msg: 'x', ts: new Date().toISOString() }] },
        { 'content-length': String(200 * 1024) }
      )
    );
    expect(res.status).toBe(413);
  });

  it('rejects > 20 records per batch', async () => {
    const records = Array.from({ length: 21 }, () => ({
      level: 'info',
      msg: 'x',
      ts: new Date().toISOString()
    }));
    const res = await POST(makeEvent({ records }));
    expect(res.status).toBe(413);
  });

  it('drops individual records > 8kb but still 204s the batch', async () => {
    const big = 'x'.repeat(9000);
    const res = await POST(
      makeEvent({
        records: [{ level: 'info', msg: big, ts: new Date().toISOString() }]
      })
    );
    expect(res.status).toBe(204);
  });

  it('rejects records with invalid level', async () => {
    const res = await POST(
      makeEvent({
        records: [{ level: 'verbose', msg: 'x', ts: new Date().toISOString() }]
      })
    );
    expect(res.status).toBe(400);
  });

  it('quarantines untrusted client ctx so it cannot forge reserved fields (#32)', async () => {
    const calls: Array<{ level: string; msg: string; ctx: Record<string, unknown> }> = [];
    const mk = (level: string) => (msg: string, ctx?: Record<string, unknown>) =>
      void calls.push({ level, msg, ctx: ctx ?? {} });
    const capturing = {
      debug: mk('debug'),
      info: mk('info'),
      warn: mk('warn'),
      error: mk('error'),
      child() {
        return this;
      }
    } as unknown as import('$lib/server/logger').Logger;

    const res = await POST(
      makeEvent(
        {
          records: [
            {
              level: 'info',
              msg: 'real',
              ts: '2026-01-01T00:00:00.000Z',
              ctx: {
                request_id: 'forged',
                route: '/admin',
                source: 'server',
                component: 'OcrPreview'
              }
            }
          ]
        },
        {},
        capturing
      )
    );
    expect(res.status).toBe(204);
    expect(calls).toHaveLength(1);
    const { ctx } = calls[0];
    // Server-owned source wins; the forged request_id/route are NOT promoted to
    // top-level where they'd overwrite the per-request binding.
    expect(ctx.source).toBe('client');
    expect(ctx.request_id).toBeUndefined();
    expect(ctx.route).toBeUndefined();
    // The client's fields are preserved, but quarantined under client_ctx.
    expect(ctx.client_ctx).toMatchObject({
      request_id: 'forged',
      route: '/admin',
      source: 'server',
      component: 'OcrPreview'
    });
  });

  it('evicts expired per-IP buckets on a later request (no unbounded map growth)', async () => {
    // Buckets are only ever rewritten by their own IP, so entries for IPs
    // that never return used to live forever.
    vi.useFakeTimers();
    try {
      const record = () => ({
        records: [{ level: 'info', msg: 'x', ts: new Date().toISOString() }]
      });
      await POST(makeEvent(record(), {}, noopLogger, '10.0.0.1'));
      await POST(makeEvent(record(), {}, noopLogger, '10.0.0.2'));
      expect(_bucketCountForTests()).toBe(2);
      vi.advanceTimersByTime(2 * 60_000); // both buckets expire
      const res = await POST(makeEvent(record(), {}, noopLogger, '10.0.0.3'));
      expect(res.status).toBe(204);
      expect(_bucketCountForTests()).toBe(1); // only 10.0.0.3 remains
    } finally {
      vi.useRealTimers();
    }
  });

  it('rate-limits at 60 req/min per IP', async () => {
    for (let i = 0; i < 60; i++) {
      const res = await POST(
        makeEvent({
          records: [{ level: 'info', msg: 'x', ts: new Date().toISOString() }]
        })
      );
      expect(res.status).toBe(204);
    }
    const limited = await POST(
      makeEvent({
        records: [{ level: 'info', msg: 'x', ts: new Date().toISOString() }]
      })
    );
    expect(limited.status).toBe(429);
  });
});
