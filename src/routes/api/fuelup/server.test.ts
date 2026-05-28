// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { POST, _resetForTests } from './+server';

const upstream = setupServer();
beforeAll(() => upstream.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { upstream.resetHandlers(); _resetForTests(); });
afterAll(() => upstream.close());

beforeAll(() => {
  process.env.LUBELOGGER_URL = 'http://lubelog:8080';
  process.env.LUBELOGGER_API_KEY = 'k';
  process.env.LUBELOGGER_VOLUME_UNIT = 'gallons_us';
  process.env.LUBELOGGER_CURRENCY = 'USD';
});

const noopLogger = {
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
  child() { return this; }
} as unknown as import('$lib/server/logger').Logger;

function event(body: unknown) {
  const request = new Request('http://app/api/fuelup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { request, locals: { logger: noopLogger, requestId: 't' } } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/fuelup — culture-invariant write', () => {
  it('sends date as ISO YYYY-MM-DD in the upstream form-data', async () => {
    let observedDate = '';
    let observedCulture = '';
    upstream.use(
      http.post('http://lubelog:8080/api/vehicle/gasrecords/add', async ({ request }) => {
        observedCulture = request.headers.get('culture-invariant') ?? '';
        const fd = await request.formData();
        observedDate = String(fd.get('date') ?? '');
        return HttpResponse.json({ success: true });
      })
    );
    const res = await POST(event({
      vehicleId: 1, date: '2026-05-28', odometer: 87500, volume: 0.001,
      volumeUnit: 'gal', cost: 0.01, currency: 'USD',
      isFillToFull: false, missedFuelup: false,
      clientSubmissionId: '11111111-1111-1111-1111-111111111111'
    }));
    expect(res.status).toBe(200);
    expect(observedDate).toBe('2026-05-28');
    expect(observedCulture).toBe('true');
  });
});
