import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Handle, RequestEvent } from '@sveltejs/kit';
import { _resetLoggerForTests } from '$lib/server/logger';
import { handle, _newRequestId, _originBlocked } from './hooks.server';

// The hook logs through the global getLogger(), which writes JSON lines to
// process.stdout (the fallback logger the hook uses once _instance is reset is
// always pretty=false). Tests additionally force LOG_PRETTY=0 so a first-call
// boot stays JSON too. Spy on the write, JSON-parse each line, and assert on
// the emitted `msg`.
function captureStdout(): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const collect = (chunk: unknown): boolean => {
    for (const line of String(chunk).split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        // A non-JSON (pretty) line — ignored; these tests force LOG_PRETTY=0.
      }
    }
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(
    collect as unknown as typeof process.stdout.write
  );
  return records;
}

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
    process.env.LOG_PRETTY = '0';
    _resetLoggerForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOG_PRETTY;
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
    const resolve = async () =>
      new Response('ok', {
        status: 200,
        headers: { 'x-request-id': 'preset-id' }
      });
    const res = await (handle as Handle)({ event, resolve });
    expect(res.headers.get('X-Request-ID')).toBe('preset-id');
  });

  // R1 — the old version of this test only asserted X-Request-ID presence, so it
  // could never fail if silencing regressed. It now asserts the actual outcome:
  // ZERO 'request' access-log lines for the silenced paths (still checking the
  // header, since that IS emitted for them).
  it('emits no access-log line for silenced paths but still sets X-Request-ID', async () => {
    const records = captureStdout();
    for (const path of ['/healthz', '/service-worker.js', '/favicon.ico', '/_app/version.json']) {
      const event = makeEvent({ url: new URL(`http://localhost${path}`) });
      const res = await (handle as Handle)({
        event,
        resolve: async () => new Response('ok')
      });
      expect(res.headers.get('X-Request-ID')).toBeTruthy();
    }
    expect(records.filter((r) => r.msg === 'request')).toHaveLength(0);
  });

  // Positive control: proves the assertion above can fail — a non-silenced path
  // DOES emit exactly one access-log line, carrying method/path/status.
  it('emits one access-log line for a non-silenced path', async () => {
    const records = captureStdout();
    const event = makeEvent({ url: new URL('http://localhost/api/vehicle/image?vehicleId=1') });
    await (handle as Handle)({
      event,
      resolve: async () => new Response('ok', { status: 200 })
    });
    const accessLogs = records.filter((r) => r.msg === 'request');
    expect(accessLogs).toHaveLength(1);
    expect(accessLogs[0]).toMatchObject({ method: 'GET', path: '/api/vehicle/image', status: 200 });
  });

  // T5 — the last-resort fence at hooks.server.ts:117-120 had zero tests. A
  // throwing resolve() must produce a 500 'Internal Error', keep the
  // X-Request-ID, and log 'handler threw'.
  it('returns 500 Internal Error and logs "handler threw" when resolve throws', async () => {
    const records = captureStdout();
    const event = makeEvent({ url: new URL('http://localhost/api/vehicle/image?vehicleId=1') });
    const res = await (handle as Handle)({
      event,
      resolve: async () => {
        throw new Error('boom in handler');
      }
    });
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Internal Error');
    expect(res.headers.get('X-Request-ID')).toBe(event.locals.requestId);
    expect(records.filter((r) => r.msg === 'handler threw')).toHaveLength(1);
    // and the access log for the failed request still fires at error level
    expect(records.filter((r) => r.msg === 'request' && r.status === 500)).toHaveLength(1);
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
