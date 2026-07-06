import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { GET } from '../../src/routes/healthz/+server';

const upstream = setupServer();
beforeAll(() => upstream.listen({ onUnhandledRequest: 'error' }));
afterEach(() => upstream.resetHandlers());
afterAll(() => upstream.close());

beforeAll(() => {
  process.env.LUBELOGGER_URL = 'http://lubelog:8080';
  process.env.LUBELOGGER_API_KEY = 'k';
});

const noopLogger = {
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
  child() { return this; }
} as unknown as import('../../src/lib/server/logger').Logger;

function eventFor(logger = noopLogger): Parameters<typeof GET>[0] {
  return { locals: { logger, requestId: 't' } } as unknown as Parameters<typeof GET>[0];
}

describe('GET /healthz', () => {
  it('returns 200 when LubeLogger is reachable', async () => {
    upstream.use(
      http.get('http://lubelog:8080/api/vehicles', () => HttpResponse.json([]))
    );
    const res = await GET(eventFor());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 503 when LubeLogger is unreachable', async () => {
    upstream.use(
      http.get('http://lubelog:8080/api/vehicles', () =>
        new HttpResponse(null, { status: 503 })
      )
    );
    const res = await GET(eventFor());
    expect(res.status).toBe(503);
  });

  it('does not leak upstream error detail in the 503 body (logged server-side instead)', async () => {
    // LubeLoggerError.message embeds the upstream status + a 200-char body
    // preview; healthz is unauthenticated, so none of that may be echoed.
    upstream.use(
      http.get('http://lubelog:8080/api/vehicles', () =>
        new HttpResponse('SECRET-internal-detail-xyz', { status: 500 })
      )
    );
    const warns: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];
    const capturing = {
      ...noopLogger,
      warn: (msg: string, ctx?: Record<string, unknown>) => void warns.push({ msg, ctx })
    } as unknown as import('../../src/lib/server/logger').Logger;

    const res = await GET(eventFor(capturing));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: 'upstream unreachable' });
    expect(JSON.stringify(body)).not.toContain('SECRET-internal-detail-xyz');
    // The real cause still reaches the server log.
    expect(warns.some((w) => w.msg === 'healthz upstream check failed')).toBe(true);
  });
});
