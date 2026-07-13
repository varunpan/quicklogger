import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { GET } from '../../src/routes/api/vehicle/last-fuelup/+server';

const upstream = setupServer();
beforeAll(() => upstream.listen({ onUnhandledRequest: 'error' }));
afterEach(() => upstream.resetHandlers());
afterAll(() => upstream.close());

beforeAll(() => {
  process.env.LUBELOGGER_URL = 'http://lubelog:8080';
  process.env.LUBELOGGER_API_KEY = 'k';
});

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child() {
    return this;
  }
} as unknown as import('../../src/lib/server/logger').Logger;

function eventFor(vehicleId?: string) {
  const u = new URL('http://localhost/api/vehicle/last-fuelup');
  if (vehicleId !== undefined) u.searchParams.set('vehicleId', vehicleId);
  return { url: u, locals: { logger: noopLogger, requestId: 't' } } as unknown as Parameters<
    typeof GET
  >[0];
}

describe('GET /api/vehicle/last-fuelup', () => {
  it('returns the most recent record by date', async () => {
    upstream.use(
      http.get('http://lubelog:8080/api/vehicle/gasrecords', () =>
        HttpResponse.json([
          {
            id: 1,
            vehicleId: 1,
            date: '2026-04-01',
            odometer: 85000,
            fuelConsumed: 11.0,
            cost: 40.0,
            fuelEconomy: 0,
            isFillToFull: true,
            missedFuelUp: false,
            notes: null,
            tags: '',
            extraFields: [],
            files: []
          },
          {
            id: 2,
            vehicleId: 1,
            date: '2026-04-15',
            odometer: 86000,
            fuelConsumed: 11.5,
            cost: 42.0,
            fuelEconomy: 0,
            isFillToFull: true,
            missedFuelUp: false,
            notes: null,
            tags: '',
            extraFields: [],
            files: []
          },
          {
            id: 3,
            vehicleId: 1,
            date: '2026-04-08',
            odometer: 85500,
            fuelConsumed: 11.2,
            cost: 41.0,
            fuelEconomy: 0,
            isFillToFull: true,
            missedFuelUp: false,
            notes: null,
            tags: '',
            extraFields: [],
            files: []
          }
        ])
      )
    );
    const res = await GET(eventFor('1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(2);
    expect(body.odometer).toBe(86000);
    expect(body.fuelConsumed).toBe(11.5);
  });

  it('same-date tie returns the record with the higher odometer', async () => {
    // Two fillups on the same day: day-resolution dates can't order them, but
    // the later fillup always has the larger reading. A strict `>` reduce
    // kept the first array entry (the earlier fillup) — the regression this
    // guards against.
    upstream.use(
      http.get('http://lubelog:8080/api/vehicle/gasrecords', () =>
        HttpResponse.json([
          {
            id: 1,
            vehicleId: 1,
            date: '2026-04-15',
            odometer: 86000,
            fuelConsumed: 11.0,
            cost: 40.0,
            fuelEconomy: 0,
            isFillToFull: true,
            missedFuelUp: false,
            notes: null,
            tags: '',
            extraFields: [],
            files: []
          },
          {
            id: 2,
            vehicleId: 1,
            date: '2026-04-15',
            odometer: 86450,
            fuelConsumed: 11.5,
            cost: 42.0,
            fuelEconomy: 0,
            isFillToFull: true,
            missedFuelUp: false,
            notes: null,
            tags: '',
            extraFields: [],
            files: []
          }
        ])
      )
    );
    const res = await GET(eventFor('1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(2);
    expect(body.odometer).toBe(86450);
  });

  it('same-date tie keeps the higher odometer even when it comes first in the array', async () => {
    upstream.use(
      http.get('http://lubelog:8080/api/vehicle/gasrecords', () =>
        HttpResponse.json([
          {
            id: 1,
            vehicleId: 1,
            date: '2026-04-15',
            odometer: 86450,
            fuelConsumed: 11.5,
            cost: 42.0,
            fuelEconomy: 0,
            isFillToFull: true,
            missedFuelUp: false,
            notes: null,
            tags: '',
            extraFields: [],
            files: []
          },
          {
            id: 2,
            vehicleId: 1,
            date: '2026-04-15',
            odometer: 86000,
            fuelConsumed: 11.0,
            cost: 40.0,
            fuelEconomy: 0,
            isFillToFull: true,
            missedFuelUp: false,
            notes: null,
            tags: '',
            extraFields: [],
            files: []
          }
        ])
      )
    );
    const res = await GET(eventFor('1'));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(1);
  });

  it('full tie (same date, same odometer) returns the later array entry', async () => {
    upstream.use(
      http.get('http://lubelog:8080/api/vehicle/gasrecords', () =>
        HttpResponse.json([
          {
            id: 1,
            vehicleId: 1,
            date: '2026-04-15',
            odometer: 86000,
            fuelConsumed: 11.0,
            cost: 40.0,
            fuelEconomy: 0,
            isFillToFull: true,
            missedFuelUp: false,
            notes: null,
            tags: '',
            extraFields: [],
            files: []
          },
          {
            id: 2,
            vehicleId: 1,
            date: '2026-04-15',
            odometer: 86000,
            fuelConsumed: 11.0,
            cost: 40.0,
            fuelEconomy: 0,
            isFillToFull: true,
            missedFuelUp: false,
            notes: null,
            tags: '',
            extraFields: [],
            files: []
          }
        ])
      )
    );
    const res = await GET(eventFor('1'));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(2);
  });

  it('returns 200 with null when no records exist', async () => {
    upstream.use(
      http.get('http://lubelog:8080/api/vehicle/gasrecords', () => HttpResponse.json([]))
    );
    const res = await GET(eventFor('1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it('returns 400 when vehicleId is missing', async () => {
    const res = await GET(eventFor());
    expect(res.status).toBe(400);
  });

  // T6 — the entire 502 (LubeLoggerError) arm was untested. Mirror of
  // api-fuelup's "no upstream details leak" test: an upstream 5xx becomes a
  // generic 502, and the upstream body never reaches the client.
  it('maps an upstream 5xx to 502 with a generic message — no upstream detail leak', async () => {
    upstream.use(
      http.get(
        'http://lubelog:8080/api/vehicle/gasrecords',
        () => new HttpResponse('secret internal detail', { status: 503 })
      )
    );
    const res = await GET(eventFor('1'));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/LubeLogger/);
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
  });
});
