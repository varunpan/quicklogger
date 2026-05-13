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

function urlFor(vehicleId?: string) {
  const u = new URL('http://localhost/api/vehicle/reminders');
  if (vehicleId !== undefined) u.searchParams.set('vehicleId', vehicleId);
  return u;
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
    const res = await GET({ url: urlFor('1') } as unknown as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].description).toBe('Brake Fluid');
  });

  it('returns 200 with empty array when no reminders exist', async () => {
    upstream.use(
      http.get('http://lubelog:8080/api/vehicle/reminders', () => HttpResponse.json([]))
    );
    const res = await GET({ url: urlFor('1') } as unknown as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns 400 when vehicleId is missing', async () => {
    const res = await GET({ url: urlFor() } as unknown as Parameters<typeof GET>[0]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'vehicleId required' });
  });

  it('returns 400 when vehicleId is not finite', async () => {
    const res = await GET({ url: urlFor('abc') } as unknown as Parameters<typeof GET>[0]);
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
    const res = await GET({ url: urlFor('1') } as unknown as Parameters<typeof GET>[0]);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/LubeLogger 401/);
  });

  it('returns 502 when upstream is 5xx', async () => {
    upstream.use(
      http.get(
        'http://lubelog:8080/api/vehicle/reminders',
        () => new HttpResponse(null, { status: 503 })
      )
    );
    const res = await GET({ url: urlFor('1') } as unknown as Parameters<typeof GET>[0]);
    expect(res.status).toBe(502);
  });
});
