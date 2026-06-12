import { describe, it, expect, beforeEach } from 'vitest';
import type { Handle, RequestEvent } from '@sveltejs/kit';
import { _resetLoggerForTests } from '$lib/server/logger';
import { handle, _newRequestId, _originBlocked } from './hooks.server';

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

describe('_originBlocked (CSRF origin predicate)', () => {
  const EXPECTED = 'http://localhost';

  it('blocks a mutating request whose Origin is present and mismatched', () => {
    expect(_originBlocked('POST', 'http://evil.example', EXPECTED)).toBe(true);
    expect(_originBlocked('PUT', 'http://evil.example', EXPECTED)).toBe(true);
    expect(_originBlocked('PATCH', 'http://evil.example', EXPECTED)).toBe(true);
    expect(_originBlocked('DELETE', 'http://evil.example', EXPECTED)).toBe(true);
  });

  it('allows a mutating request whose Origin matches the expected origin', () => {
    expect(_originBlocked('POST', EXPECTED, EXPECTED)).toBe(false);
  });

  it('allows a mutating request with NO Origin (non-browser client, e.g. Apple Shortcuts)', () => {
    expect(_originBlocked('POST', null, EXPECTED)).toBe(false);
  });

  it('never blocks safe methods even on an origin mismatch', () => {
    expect(_originBlocked('GET', 'http://evil.example', EXPECTED)).toBe(false);
    expect(_originBlocked('HEAD', 'http://evil.example', EXPECTED)).toBe(false);
    expect(_originBlocked('OPTIONS', 'http://evil.example', EXPECTED)).toBe(false);
  });
});

describe('CSRF origin guard (through handle)', () => {
  beforeEach(() => {
    process.env.LUBELOGGER_URL = 'http://lubelog:8080';
    process.env.LUBELOGGER_API_KEY = 'k';
    _resetLoggerForTests();
  });

  function postEvent(headers: Record<string, string> = {}): RequestEvent {
    const url = new URL('http://localhost/api/fuelup');
    return makeEvent({
      url,
      request: new Request(url, { method: 'POST', headers }),
      route: { id: '/api/fuelup' }
    });
  }

  it('rejects a cross-origin POST with 403 and never calls resolve', async () => {
    let resolved = false;
    const event = postEvent({ origin: 'http://evil.example' });
    const res = await (handle as Handle)({
      event,
      resolve: async () => {
        resolved = true;
        return new Response('ok', { status: 200 });
      }
    });
    expect(res.status).toBe(403);
    expect(resolved).toBe(false);
    expect(await res.json()).toEqual({ error: 'origin not allowed' });
    expect(res.headers.get('X-Request-ID')).toBeTruthy();
  });

  it('passes a same-origin POST through to resolve', async () => {
    let resolved = false;
    const event = postEvent({ origin: 'http://localhost' });
    const res = await (handle as Handle)({
      event,
      resolve: async () => {
        resolved = true;
        return new Response('ok', { status: 200 });
      }
    });
    expect(resolved).toBe(true);
    expect(res.status).toBe(200);
  });

  it('passes a POST with no Origin header through to resolve (non-browser client)', async () => {
    let resolved = false;
    const event = postEvent();
    const res = await (handle as Handle)({
      event,
      resolve: async () => {
        resolved = true;
        return new Response('ok', { status: 200 });
      }
    });
    expect(resolved).toBe(true);
    expect(res.status).toBe(200);
  });
});
