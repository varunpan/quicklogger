import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { GET, _resetCache } from '../../src/routes/api/vehicles/+server';

const upstream = setupServer();
beforeAll(() => upstream.listen({ onUnhandledRequest: 'error' }));
afterEach(() => upstream.resetHandlers());
afterAll(() => upstream.close());

beforeAll(() => {
  process.env.LUBELOGGER_URL = 'http://lubelog:8080';
  process.env.LUBELOGGER_API_KEY = 'k';
});

beforeEach(() => _resetCache());

const noopLogger = {
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
  child() { return this; }
} as unknown as import('../../src/lib/server/logger').Logger;

function eventFor(): Parameters<typeof GET>[0] {
  return { locals: { logger: noopLogger, requestId: 't' } } as unknown as Parameters<typeof GET>[0];
}

describe('GET /api/vehicles', () => {
  it('proxies to lubelogger and returns the vehicle array', async () => {
    upstream.use(
      http.get('http://lubelog:8080/api/vehicles', () =>
        HttpResponse.json([{ id: 1, year: 2019, make: 'Honda', model: 'Civic Si' }])
      )
    );
    const res = await GET(eventFor());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(1);
  });

  it('caches subsequent calls within 5 minutes', async () => {
    let calls = 0;
    upstream.use(
      http.get('http://lubelog:8080/api/vehicles', () => {
        calls++;
        return HttpResponse.json([{ id: 1 }]);
      })
    );
    await GET(eventFor());
    await GET(eventFor());
    await GET(eventFor());
    expect(calls).toBe(1);
  });

  it('returns 502 when LubeLogger 5xx', async () => {
    upstream.use(
      http.get('http://lubelog:8080/api/vehicles', () => new HttpResponse(null, { status: 503 }))
    );
    const res = await GET(eventFor());
    expect(res.status).toBe(502);
  });

  it('hoists VIN from extraFields into a top-level vin field', async () => {
    upstream.use(
      http.get('http://lubelog:8080/api/vehicles', () =>
        HttpResponse.json([
          {
            id: 1,
            year: 2014,
            make: 'Honda',
            model: 'Accord',
            licensePlate: 'MBL4635',
            extraFields: [
              { name: 'VIN', value: '1HGCR2F80EA00735', isRequired: false, fieldType: 0 },
              { name: 'Trim', value: 'EX-L', isRequired: false, fieldType: 0 }
            ]
          }
        ])
      )
    );
    const res = await GET(eventFor());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].vin).toBe('1HGCR2F80EA00735');
    expect(body[0].licensePlate).toBe('MBL4635');
    // extraFields still passes through unchanged.
    expect(body[0].extraFields).toEqual([
      { name: 'VIN', value: '1HGCR2F80EA00735', isRequired: false, fieldType: 0 },
      { name: 'Trim', value: 'EX-L', isRequired: false, fieldType: 0 }
    ]);
  });

  it('omits the vin key when extraFields has no VIN row', async () => {
    upstream.use(
      http.get('http://lubelog:8080/api/vehicles', () =>
        HttpResponse.json([
          {
            id: 1,
            year: 2014,
            make: 'Honda',
            model: 'Accord',
            licensePlate: 'MBL4635',
            extraFields: [{ name: 'Trim', value: 'EX-L' }]
          }
        ])
      )
    );
    const res = await GET(eventFor());
    const body = await res.json();
    expect('vin' in body[0]).toBe(false);
    expect(body[0].licensePlate).toBe('MBL4635');
  });
});
