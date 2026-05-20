import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { LubeLoggerClient } from './lubelogger';
import type { Logger } from './logger';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const BASE = 'http://lubelog:8080';
const KEY = 'test-key-123';

function client() {
	return new LubeLoggerClient({ baseUrl: BASE, apiKey: KEY });
}

describe('LubeLoggerClient', () => {
	it('lists vehicles with x-api-key header', async () => {
		let observedKey = '';
		server.use(
			http.get(`${BASE}/api/vehicles`, ({ request }) => {
				observedKey = request.headers.get('x-api-key') ?? '';
				return HttpResponse.json([{ id: 1, year: 2019, make: 'Honda', model: 'Civic Si' }]);
			})
		);
		const vs = await client().listVehicles();
		expect(observedKey).toBe(KEY);
		expect(vs).toHaveLength(1);
		expect(vs[0]).toMatchObject({ id: 1, make: 'Honda' });
	});

	it('lists gas records for a vehicle', async () => {
		let observedQs = '';
		server.use(
			http.get(`${BASE}/api/vehicle/gasrecords`, ({ request }) => {
				observedQs = new URL(request.url).searchParams.toString();
				return HttpResponse.json([
					{
						id: '100',
						vehicleId: '1',
						date: '04/12/2026',
						odometer: '87000',
						fuelConsumed: '11.2',
						cost: '42.18',
						fuelEconomy: '0',
						isFillToFull: 'True',
						missedFuelUp: 'False',
						notes: '',
						tags: '',
						extraFields: [],
						files: []
					}
				]);
			})
		);
		const records = await client().listGasRecords(1);
		expect(observedQs).toBe('vehicleId=1');
		expect(records[0].id).toBe('100');
		expect(records[0].fuelConsumed).toBe('11.2');
		expect(records[0].isFillToFull).toBe('True');
	});

	it('adds a gas record as form-data', async () => {
		let observedQs = '';
		let observedBody: FormData | undefined;
		server.use(
			http.post(`${BASE}/api/vehicle/gasrecords/add`, async ({ request }) => {
				observedQs = new URL(request.url).searchParams.toString();
				observedBody = await request.formData();
				return HttpResponse.json({ success: true });
			})
		);
		await client().addGasRecord(1, {
			date: '05/07/2026',
			odometer: '87432',
			fuelconsumed: '11.2',
			isfilltofull: 'true',
			missedfuelup: 'false',
			cost: '42.18'
		});
		expect(observedQs).toBe('vehicleId=1');
		expect(observedBody?.get('date')).toBe('05/07/2026');
		expect(observedBody?.get('fuelconsumed')).toBe('11.2');
		expect(observedBody?.get('cost')).toBe('42.18');
	});

	it('throws LubeLoggerError on 401', async () => {
		server.use(
			http.get(`${BASE}/api/vehicles`, () => new HttpResponse('unauthorized', { status: 401 }))
		);
		await expect(client().listVehicles()).rejects.toMatchObject({
			name: 'LubeLoggerError',
			status: 401
		});
	});

	it('throws LubeLoggerError on 5xx', async () => {
		server.use(http.get(`${BASE}/api/vehicles`, () => new HttpResponse(null, { status: 503 })));
		await expect(client().listVehicles()).rejects.toMatchObject({ status: 503 });
	});

	it('lists reminders for a vehicle', async () => {
		let observedQs = '';
		server.use(
			http.get(`${BASE}/api/vehicle/reminders`, ({ request }) => {
				observedQs = new URL(request.url).searchParams.toString();
				return HttpResponse.json([
					{
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
					},
					{
						vehicleId: '1',
						id: '12',
						description: 'Engine Oil change',
						urgency: 'PastDue',
						metric: 'Date',
						userMetric: 'Both',
						notes: '',
						dueDate: '4/12/2026',
						dueOdometer: '115316',
						dueDays: '-31',
						dueDistance: '5764',
						tags: ''
					}
				]);
			})
		);
		const reminders = await client().listReminders(1);
		expect(observedQs).toBe('vehicleId=1');
		expect(reminders).toHaveLength(2);
		expect(reminders[0].description).toBe('Brake Fluid');
		expect(reminders[0].urgency).toBe('PastDue');
		expect(reminders[1].userMetric).toBe('Both');
	});

	it('throws LubeLoggerError on reminders 4xx', async () => {
		server.use(
			http.get(
				`${BASE}/api/vehicle/reminders`,
				() => new HttpResponse('not found', { status: 404 })
			)
		);
		await expect(client().listReminders(99)).rejects.toMatchObject({
			name: 'LubeLoggerError',
			status: 404
		});
	});

	it('throws LubeLoggerError on reminders 5xx', async () => {
		server.use(
			http.get(`${BASE}/api/vehicle/reminders`, () => new HttpResponse(null, { status: 503 }))
		);
		await expect(client().listReminders(1)).rejects.toMatchObject({ status: 503 });
	});

	it('fetches an image with x-api-key and returns the raw Response', async () => {
		let observedKey = '';
		const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
		server.use(
			http.get(`${BASE}/images/abc-123.jpg`, ({ request }) => {
				observedKey = request.headers.get('x-api-key') ?? '';
				return new HttpResponse(bytes, {
					status: 200,
					headers: { 'content-type': 'image/jpeg' }
				});
			})
		);
		const res = await client().fetchImage('/images/abc-123.jpg');
		expect(observedKey).toBe(KEY);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/jpeg');
		const buf = new Uint8Array(await res.arrayBuffer());
		expect(buf).toEqual(bytes);
	});

	it('throws LubeLoggerError on fetchImage 4xx', async () => {
		server.use(
			http.get(`${BASE}/images/missing.jpg`, () => new HttpResponse('not found', { status: 404 }))
		);
		await expect(client().fetchImage('/images/missing.jpg')).rejects.toMatchObject({
			name: 'LubeLoggerError',
			status: 404
		});
	});

	it('throws LubeLoggerError on fetchImage 5xx', async () => {
		server.use(
			http.get(`${BASE}/images/oops.jpg`, () => new HttpResponse(null, { status: 503 }))
		);
		await expect(client().fetchImage('/images/oops.jpg')).rejects.toMatchObject({ status: 503 });
	});
});

interface CapturedRec { level: string; msg: string; ctx: Record<string, unknown>; }
function captureLogger(): { logger: Logger; recs: CapturedRec[] } {
  const recs: CapturedRec[] = [];
  function mk(): Logger {
    const log = (level: string) => (msg: string, ctx?: Record<string, unknown>) =>
      void recs.push({ level, msg, ctx: ctx ?? {} });
    return {
      debug: log('debug') as Logger['debug'],
      info: log('info') as Logger['info'],
      warn: log('warn') as Logger['warn'],
      error: log('error') as Logger['error'],
      child: () => mk()
    };
  }
  return { logger: mk(), recs };
}

describe('LubeLoggerClient — logging', () => {
  it('emits one debug record per request at start', async () => {
    server.use(http.get(`${BASE}/api/vehicles`, () => HttpResponse.json([])));
    const { logger, recs } = captureLogger();
    await new LubeLoggerClient({ baseUrl: BASE, apiKey: KEY, logger }).listVehicles();
    const debugs = recs.filter((r) => r.level === 'debug');
    expect(debugs).toHaveLength(1);
    expect(debugs[0].msg).toBe('lubelogger request');
    expect(debugs[0].ctx.upstream_method).toBe('GET');
    expect(debugs[0].ctx.upstream_path).toBe('/api/vehicles');
  });

  it('emits one warn record on non-OK upstream response', async () => {
    server.use(http.get(`${BASE}/api/vehicles`, () => new HttpResponse('not authorized', { status: 401 })));
    const { logger, recs } = captureLogger();
    const client = new LubeLoggerClient({ baseUrl: BASE, apiKey: KEY, logger });
    await expect(client.listVehicles()).rejects.toMatchObject({ name: 'LubeLoggerError' });
    const warns = recs.filter((r) => r.level === 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0].msg).toBe('lubelogger non-ok');
    expect(warns[0].ctx.upstream_status).toBe(401);
    expect(warns[0].ctx.upstream_body_preview).toContain('not authorized');
  });

  it('emits one error record on network failure', async () => {
    const { logger, recs } = captureLogger();
    const failFetch: typeof fetch = () => Promise.reject(new TypeError('ECONNREFUSED'));
    const client = new LubeLoggerClient({ baseUrl: BASE, apiKey: KEY, fetchImpl: failFetch, logger });
    await expect(client.listVehicles()).rejects.toThrow('ECONNREFUSED');
    const errors = recs.filter((r) => r.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].msg).toBe('lubelogger fetch failed');
    expect(errors[0].ctx.upstream_method).toBe('GET');
    expect(errors[0].ctx.upstream_path).toBe('/api/vehicles');
    const errCtx = errors[0].ctx.err as Record<string, unknown> | undefined;
    expect(errCtx?.message).toBe('ECONNREFUSED');
  });

  it('emits one error record on AbortSignal timeout', async () => {
    const { logger, recs } = captureLogger();
    const slowFetch: typeof fetch = (_u, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }
      });
    const client = new LubeLoggerClient({
      baseUrl: BASE, apiKey: KEY, fetchImpl: slowFetch, timeoutMs: 10, logger
    });
    await expect(client.listVehicles()).rejects.toThrow();
    const errors = recs.filter((r) => r.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].msg).toBe('lubelogger timeout');
    expect(errors[0].ctx.timeout_ms).toBe(10);
  });

  it('client works without a logger (no-op)', async () => {
    server.use(http.get(`${BASE}/api/vehicles`, () => HttpResponse.json([])));
    const client = new LubeLoggerClient({ baseUrl: BASE, apiKey: KEY });
    await expect(client.listVehicles()).resolves.toEqual([]);
  });
});
