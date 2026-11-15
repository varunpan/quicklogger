// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { GET } from './+server';

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
} as unknown as import('$lib/server/logger').Logger;

function eventFor(vehicleId?: string) {
  const u = new URL('http://localhost/api/vehicle/odometer-records');
  if (vehicleId !== undefined) u.searchParams.set('vehicleId', vehicleId);
  return { url: u, locals: { logger: noopLogger, requestId: 't' } } as unknown as Parameters<
    typeof GET
  >[0];
}

describe('GET /api/vehicle/odometer-records', () => {
  it('requires a vehicleId', async () => {
    expect((await GET(eventFor())).status).toBe(400);
  });

  it('returns date, odometer and equipment ids only', async () => {
    upstream.use(
      http.get('http://lubelog:8080/api/vehicle/odometerrecords', () =>
        HttpResponse.json([
          {
            id: 1,
            date: '2026-11-15',
            initialOdometer: 45300,
            odometer: 45420,
            equipmentRecordId: '7',
            notes: 'secret-ish'
          }
        ])
      )
    );
    const res = await GET(eventFor('3'));
    expect(await res.json()).toEqual([{ date: '2026-11-15', odometer: 45420, equipmentIds: [7] }]);
  });

  it('maps an upstream failure to 502', async () => {
    upstream.use(
      http.get(
        'http://lubelog:8080/api/vehicle/odometerrecords',
        () => new HttpResponse('x', { status: 500 })
      )
    );
    expect((await GET(eventFor('3'))).status).toBe(502);
  });
});
