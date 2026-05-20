import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { GET } from '../../src/routes/api/vehicle/reminders/+server';

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

function eventFor(vehicleId?: string) {
  const u = new URL('http://localhost/api/vehicle/reminders');
  if (vehicleId !== undefined) u.searchParams.set('vehicleId', vehicleId);
  return { url: u, locals: { logger: noopLogger, requestId: 't' } } as unknown as Parameters<typeof GET>[0];
}

const sampleReminder = {
  vehicleId: '1',
  id: '5',
  description: 'Brake Fluid',
  urgency: 'PastDue',
  metric: 'Date',
  userMetric: 'Date',
  notes: '',
  dueDate: '3/30/2026',
  dueOdometer: '0',
  dueDays: '-44',
  dueDistance: '0',
  tags: ''
};

describe('GET /api/vehicle/reminders', () => {
  it('returns the array as-is on 200', async () => {
    upstream.use(
      http.get('http://lubelog:8080/api/vehicle/reminders', () =>
        HttpResponse.json([sampleReminder])
      )
    );
    const res = await GET(eventFor('1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].description).toBe('Brake Fluid');
  });

  it('returns 200 with empty array when no reminders exist', async () => {
    upstream.use(
      http.get('http://lubelog:8080/api/vehicle/reminders', () => HttpResponse.json([]))
    );
    const res = await GET(eventFor('1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns 400 when vehicleId is missing', async () => {
    const res = await GET(eventFor());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'vehicleId required' });
  });

  it('returns 400 when vehicleId is not finite', async () => {
    const res = await GET(eventFor('abc'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid vehicleId' });
  });

  it('returns 502 when upstream throws LubeLoggerError', async () => {
    upstream.use(
      http.get(
        'http://lubelog:8080/api/vehicle/reminders',
        () => new HttpResponse('unauthorized', { status: 401 })
      )
    );
    const res = await GET(eventFor('1'));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({
      error: 'Could not fetch reminders from LubeLogger',
      upstream: 'GET /api/vehicle/reminders',
      upstream_status: 401
    });
  });

  it('returns 502 when upstream is 5xx', async () => {
    upstream.use(
      http.get(
        'http://lubelog:8080/api/vehicle/reminders',
        () => new HttpResponse(null, { status: 503 })
      )
    );
    const res = await GET(eventFor('1'));
    expect(res.status).toBe(502);
  });
});
