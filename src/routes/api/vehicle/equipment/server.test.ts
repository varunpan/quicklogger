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
  const u = new URL('http://localhost/api/vehicle/equipment');
  if (vehicleId !== undefined) u.searchParams.set('vehicleId', vehicleId);
  return { url: u, locals: { logger: noopLogger, requestId: 't' } } as unknown as Parameters<
    typeof GET
  >[0];
}

describe('GET /api/vehicle/equipment', () => {
  it('returns 400 when vehicleId is missing', async () => {
    const res = await GET(eventFor());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'vehicleId required' });
  });

  it('returns 400 for a non-positive-integer vehicleId', async () => {
    const res = await GET(eventFor('3.5'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid vehicleId' });
  });

  it('normalizes LubeLogger string fields', async () => {
    upstream.use(
      http.get('http://lubelog:8080/api/vehicle/equipmentrecords', () =>
        HttpResponse.json([
          {
            id: '7',
            vehicleId: '3',
            description: 'Off-road trailer',
            isEquipped: 'True',
            distanceTraveled: '1234',
            notes: '',
            tags: ''
          },
          {
            id: '8',
            vehicleId: '3',
            description: 'Roof tent',
            isEquipped: 'False',
            distanceTraveled: '0',
            notes: '',
            tags: ''
          }
        ])
      )
    );
    const res = await GET(eventFor('3'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: 7, description: 'Off-road trailer', isEquipped: true, distanceTraveled: 1234 },
      { id: 8, description: 'Roof tent', isEquipped: false, distanceTraveled: 0 }
    ]);
  });

  it('returns 502 when LubeLogger fails', async () => {
    upstream.use(
      http.get(
        'http://lubelog:8080/api/vehicle/equipmentrecords',
        () => new HttpResponse('boom', { status: 500 })
      )
    );
    const res = await GET(eventFor('3'));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Could not fetch equipment from LubeLogger' });
  });
});
