import { describe, it, expect, beforeEach } from 'vitest';
import { POST, _resetRateLimitForTests } from './+server';

const noopLogger = {
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child() { return this; }
} as import('$lib/server/logger').Logger;

function makeEvent(body: unknown, headers: Record<string, string> = {}): import('@sveltejs/kit').RequestEvent {
  return {
    request: new Request('http://localhost/api/log', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    }),
    locals: { logger: noopLogger, requestId: 't' },
    getClientAddress: () => '127.0.0.1',
    url: new URL('http://localhost/api/log'),
    route: { id: '/api/log' }
  } as unknown as import('@sveltejs/kit').RequestEvent;
}

describe('POST /api/log', () => {
  beforeEach(() => _resetRateLimitForTests());

  it('returns 204 on happy path', async () => {
    const res = await POST(makeEvent({
      records: [{ level: 'info', msg: 'hi', ts: new Date().toISOString() }]
    }));
    expect(res.status).toBe(204);
  });

  it('rejects missing records array', async () => {
    const res = await POST(makeEvent({}));
    expect(res.status).toBe(400);
  });

  it('rejects > 20 records per batch', async () => {
    const records = Array.from({ length: 21 }, () => ({
      level: 'info', msg: 'x', ts: new Date().toISOString()
    }));
    const res = await POST(makeEvent({ records }));
    expect(res.status).toBe(413);
  });

  it('drops individual records > 8kb but still 204s the batch', async () => {
    const big = 'x'.repeat(9000);
    const res = await POST(makeEvent({
      records: [{ level: 'info', msg: big, ts: new Date().toISOString() }]
    }));
    expect(res.status).toBe(204);
  });

  it('rejects records with invalid level', async () => {
    const res = await POST(makeEvent({
      records: [{ level: 'verbose', msg: 'x', ts: new Date().toISOString() }]
    }));
    expect(res.status).toBe(400);
  });

  it('rate-limits at 60 req/min per IP', async () => {
    for (let i = 0; i < 60; i++) {
      const res = await POST(makeEvent({
        records: [{ level: 'info', msg: 'x', ts: new Date().toISOString() }]
      }));
      expect(res.status).toBe(204);
    }
    const limited = await POST(makeEvent({
      records: [{ level: 'info', msg: 'x', ts: new Date().toISOString() }]
    }));
    expect(limited.status).toBe(429);
  });
});
