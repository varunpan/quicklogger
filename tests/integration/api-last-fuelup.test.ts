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

function urlFor(vehicleId?: string) {
  const u = new URL('http://localhost/api/vehicle/last-fuelup');
  if (vehicleId !== undefined) u.searchParams.set('vehicleId', vehicleId);
  return u;
}

describe('GET /api/vehicle/last-fuelup', () => {
  it('returns the most recent record by date', async () => {
    upstream.use(
      http.get('http://lubelog:8080/api/vehicle/gasrecords', () =>
        HttpResponse.json([
          { id: '1', vehicleId: '1', date: '04/01/2026', odometer: '85000', fuelConsumed: '11.0', isFillToFull: 'True', missedFuelUp: 'False' },
          { id: '2', vehicleId: '1', date: '04/15/2026', odometer: '86000', fuelConsumed: '11.5', isFillToFull: 'True', missedFuelUp: 'False' },
          { id: '3', vehicleId: '1', date: '04/08/2026', odometer: '85500', fuelConsumed: '11.2', isFillToFull: 'True', missedFuelUp: 'False' }
        ])
      )
    );
    const res = await GET({ url: urlFor('1') } as unknown as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('2');
    expect(body.odometer).toBe('86000');
    expect(body.fuelConsumed).toBe('11.5');
  });

  it('returns 200 with null when no records exist', async () => {
    upstream.use(
      http.get('http://lubelog:8080/api/vehicle/gasrecords', () => HttpResponse.json([]))
    );
    const res = await GET({ url: urlFor('1') } as unknown as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it('returns 400 when vehicleId is missing', async () => {
    const res = await GET({ url: urlFor() } as unknown as Parameters<typeof GET>[0]);
    expect(res.status).toBe(400);
  });
});
