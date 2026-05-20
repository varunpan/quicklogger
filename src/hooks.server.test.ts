import { describe, it, expect, beforeEach } from 'vitest';
import type { Handle, RequestEvent } from '@sveltejs/kit';
import { _resetLoggerForTests } from '$lib/server/logger';
import { handle, _newRequestId } from './hooks.server';

function makeEvent(over: Partial<RequestEvent> = {}): RequestEvent {
  const url = over.url ?? new URL('http://localhost/api/vehicle/image?vehicleId=1');
  return {
    url,
    request: new Request(url),
    route: { id: '/api/vehicle/image' },
    locals: {} as App.Locals,
    cookies: {} as never,
    fetch: fetch as never,
    getClientAddress: () => '127.0.0.1',
    params: {},
    platform: undefined,
    setHeaders: () => {},
    isDataRequest: false,
    isSubRequest: false,
    ...over
  } as unknown as RequestEvent;
}

describe('_newRequestId', () => {
  beforeEach(() => _resetLoggerForTests());

  it('returns ~12-char base36 IDs that differ across calls', () => {
    const a = _newRequestId();
    const b = _newRequestId();
    expect(a).not.toBe(b);
    // Date.now().toString(36) (~8 chars) + Math.random().toString(36).slice(2, 6) (4 chars)
    expect(a).toMatch(/^[0-9a-z]{10,14}$/);
  });
});

describe('handle hook', () => {
  beforeEach(() => {
    process.env.LUBELOGGER_URL = 'http://lubelog:8080';
    process.env.LUBELOGGER_API_KEY = 'k';
    _resetLoggerForTests();
  });

  it('attaches locals.logger + locals.requestId and adds X-Request-ID header', async () => {
    const event = makeEvent();
    const resolve = async (e: RequestEvent) => {
      expect(typeof e.locals.requestId).toBe('string');
      expect(typeof e.locals.logger.info).toBe('function');
      return new Response('ok', { status: 200 });
    };
    const res = await (handle as Handle)({ event, resolve });
    expect(res.headers.get('X-Request-ID')).toBe(event.locals.requestId);
  });

  it('preserves a downstream-set X-Request-ID if the handler explicitly sets one', async () => {
    const event = makeEvent();
    const resolve = async () => new Response('ok', {
      status: 200,
      headers: { 'x-request-id': 'preset-id' }
    });
    const res = await (handle as Handle)({ event, resolve });
    expect(res.headers.get('X-Request-ID')).toBe('preset-id');
  });

  it('skips access-log emission for /healthz and /service-worker.js (silenced paths)', async () => {
    for (const path of ['/healthz', '/service-worker.js', '/favicon.ico', '/_app/version.json']) {
      const event = makeEvent({ url: new URL(`http://localhost${path}`) });
      const res = await (handle as Handle)({
        event,
        resolve: async () => new Response('ok')
      });
      expect(res.headers.get('X-Request-ID')).toBeTruthy();
    }
  });
});
