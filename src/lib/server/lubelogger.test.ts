// @vitest-environment node
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
	it('lists vehicles with x-api-key + culture-invariant header', async () => {
		let observedKey = '';
		let observedCulture = '';
		server.use(
			http.get(`${BASE}/api/vehicles`, ({ request }) => {
				observedKey = request.headers.get('x-api-key') ?? '';
				observedCulture = request.headers.get('culture-invariant') ?? '';
				return HttpResponse.json([{ id: 1, year: 2019, make: 'Honda', model: 'Civic Si' }]);
			})
		);
		const vs = await client().listVehicles();
		expect(observedKey).toBe(KEY);
		expect(observedCulture).toBe('true');
		expect(vs).toHaveLength(1);
		expect(vs[0]).toMatchObject({ id: 1, make: 'Honda' });
	});

	it('lists gas records for a vehicle (typed-ISO wire under culture-invariant)', async () => {
		let observedQs = '';
		let observedCulture = '';
		server.use(
			http.get(`${BASE}/api/vehicle/gasrecords`, ({ request }) => {
				observedQs = new URL(request.url).searchParams.toString();
				observedCulture = request.headers.get('culture-invariant') ?? '';
				return HttpResponse.json([
					{
						id: 100,
						vehicleId: 1,
						date: '2026-04-12',
						odometer: 87000,
						fuelConsumed: 11.2,
						cost: 42.18,
						fuelEconomy: 0,
						isFillToFull: true,
						missedFuelUp: false,
						notes: null,
						tags: '',
						extraFields: [],
						files: []
					}
				]);
			})
		);
		const records = await client().listGasRecords(1);
		expect(observedQs).toBe('vehicleId=1');
		expect(observedCulture).toBe('true');
		expect(records[0].id).toBe(100);
		expect(records[0].fuelConsumed).toBe(11.2);
		expect(records[0].isFillToFull).toBe(true);
		expect(records[0].notes).toBeNull();
	});

	it('adds a gas record as form-data (ISO date under culture-invariant)', async () => {
		let observedQs = '';
		let observedBody: FormData | undefined;
		let observedCulture = '';
		server.use(
			http.post(`${BASE}/api/vehicle/gasrecords/add`, async ({ request }) => {
				observedQs = new URL(request.url).searchParams.toString();
				observedCulture = request.headers.get('culture-invariant') ?? '';
				observedBody = await request.formData();
				return HttpResponse.json({ success: true });
			})
		);
		await client().addGasRecord(1, {
			date: '2026-05-07',                 // ISO directly
			odometer: '87432',
			fuelconsumed: '11.2',
			isfilltofull: 'true',
			missedfuelup: 'false',
			cost: '42.18'
		});
		expect(observedQs).toBe('vehicleId=1');
		expect(observedBody?.get('date')).toBe('2026-05-07');
		expect(observedBody?.get('fuelconsumed')).toBe('11.2');
		expect(observedBody?.get('cost')).toBe('42.18');
		expect(observedCulture).toBe('true');
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

	it('lists reminders for a vehicle (typed-ISO wire under culture-invariant)', async () => {
		let observedQs = '';
		let observedCulture = '';
		server.use(
			http.get(`${BASE}/api/vehicle/reminders`, ({ request }) => {
				observedQs = new URL(request.url).searchParams.toString();
				observedCulture = request.headers.get('culture-invariant') ?? '';
				return HttpResponse.json([
					{
						vehicleId: 1, id: 5, description: 'Brake Fluid',
						urgency: 'PastDue', metric: 'Date', userMetric: 'Date',
						notes: null, dueDate: '2026-03-30',
						dueOdometer: 0, dueDays: -44, dueDistance: 0, tags: ''
					},
					{
						vehicleId: 1, id: 12, description: 'Engine Oil change',
						urgency: 'PastDue', metric: 'Date', userMetric: 'Both',
						notes: null, dueDate: '2026-04-12',
						dueOdometer: 115316, dueDays: -31, dueDistance: 5764, tags: ''
					}
				]);
			})
		);
		const reminders = await client().listReminders(1);
		expect(observedQs).toBe('vehicleId=1');
		expect(observedCulture).toBe('true');
		expect(reminders).toHaveLength(2);
		expect(reminders[0].description).toBe('Brake Fluid');
		expect(reminders[0].notes).toBeNull();
		expect(reminders[0].dueDate).toBe('2026-03-30');
		expect(reminders[0].dueDays).toBe(-44);
		expect(reminders[1].userMetric).toBe('Both');
		expect(reminders[1].dueOdometer).toBe(115316);
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

	it('getVehicleInfo unwraps the 1-element array and returns the aggregate object', async () => {
		let observedQs = '';
		let observedCulture = '';
		server.use(
			http.get(`${BASE}/api/vehicle/info`, ({ request }) => {
				observedQs = new URL(request.url).searchParams.toString();
				observedCulture = request.headers.get('culture-invariant') ?? '';
				return HttpResponse.json([
					{
						vehicleData: { id: 1, year: 2014, make: 'Honda', model: 'Accord' },
						gasRecordCount: 22, gasRecordCost: 707.39,
						serviceRecordCount: 44, serviceRecordCost: 4164.2,
						repairRecordCount: 9, repairRecordCost: 1018.24,
						upgradeRecordCount: 1, upgradeRecordCost: 595,
						taxRecordCount: 0, taxRecordCost: 0,
						lastReportedOdometer: 111180,
						pastDueReminderCount: 2,
						veryUrgentReminderCount: 0,
						urgentReminderCount: 0,
						notUrgentReminderCount: 7,
						nextReminder: {
							vehicleId: 1, id: 12, description: 'Engine Oil change',
							urgency: 'NotUrgent', metric: 'Both', userMetric: 'Both',
							notes: null, dueDate: '2026-11-30',
							dueOdometer: 116124, dueDays: 166, dueDistance: 4944, tags: ''
						}
					}
				]);
			})
		);
		const info = await client().getVehicleInfo(1);
		expect(observedQs).toBe('vehicleId=1');
		expect(observedCulture).toBe('true');
		expect(info.vehicleData.id).toBe(1);
		expect(info.gasRecordCost).toBe(707.39);
		expect(info.taxRecordCount).toBe(0);
		expect(info.lastReportedOdometer).toBe(111180);
		expect(info.nextReminder?.description).toBe('Engine Oil change');
	});

	it('getVehicleInfo throws LubeLoggerError when upstream returns an empty array', async () => {
		server.use(http.get(`${BASE}/api/vehicle/info`, () => HttpResponse.json([])));
		await expect(client().getVehicleInfo(1)).rejects.toMatchObject({ name: 'LubeLoggerError' });
	});

	it('fetches an image with x-api-key + culture-invariant and returns the raw Response', async () => {
		let observedKey = '';
		let observedCulture = '';
		const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
		server.use(
			http.get(`${BASE}/images/abc-123.jpg`, ({ request }) => {
				observedKey = request.headers.get('x-api-key') ?? '';
				observedCulture = request.headers.get('culture-invariant') ?? '';
				return new HttpResponse(bytes, {
					status: 200,
					headers: { 'content-type': 'image/jpeg' }
				});
			})
		);
		const res = await client().fetchImage('/images/abc-123.jpg');
		expect(observedKey).toBe(KEY);
		expect(observedCulture).toBe('true');
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

	it('getInfo() sends x-api-key + culture-invariant and parses the flat info payload', async () => {
		let observedKey = '';
		let observedCulture = '';
		server.use(
			http.get(`${BASE}/api/info`, ({ request }) => {
				observedKey = request.headers.get('x-api-key') ?? '';
				observedCulture = request.headers.get('culture-invariant') ?? '';
				return HttpResponse.json({
					currentVersion: '1.6.5',
					locale: 'en-US',
					currencySymbol: '$',
					decimalSeparator: '.',
					dateFormat: 'M/d/yyyy'
				});
			})
		);
		const info = await client().getInfo();
		expect(observedKey).toBe(KEY);
		expect(observedCulture).toBe('true');
		expect(info.currentVersion).toBe('1.6.5');
		expect(info.locale).toBe('en-US');
		expect(info.currencySymbol).toBe('$');
		expect(info.decimalSeparator).toBe('.');
		expect(info.dateFormat).toBe('M/d/yyyy');
	});

	it('getVersion() sends x-api-key + culture-invariant and parses currentVersion + latestVersion', async () => {
		let observedKey = '';
		let observedCulture = '';
		server.use(
			http.get(`${BASE}/api/version`, ({ request }) => {
				observedKey = request.headers.get('x-api-key') ?? '';
				observedCulture = request.headers.get('culture-invariant') ?? '';
				return HttpResponse.json({ currentVersion: '1.6.5', latestVersion: '1.7.0' });
			})
		);
		const version = await client().getVersion();
		expect(observedKey).toBe(KEY);
		expect(observedCulture).toBe('true');
		expect(version.currentVersion).toBe('1.6.5');
		expect(version.latestVersion).toBe('1.7.0');
	});

	it('getInfo() throws LubeLoggerError on 401', async () => {
		server.use(
			http.get(`${BASE}/api/info`, () => new HttpResponse('unauthorized', { status: 401 }))
		);
		await expect(client().getInfo()).rejects.toMatchObject({ name: 'LubeLoggerError', status: 401 });
	});

	it('getVersion() throws LubeLoggerError on 404 (older LubeLogger / missing endpoint)', async () => {
		server.use(
			http.get(`${BASE}/api/version`, () => new HttpResponse('', { status: 404 }))
		);
		await expect(client().getVersion()).rejects.toMatchObject({ name: 'LubeLoggerError', status: 404 });
	});

	it('uploadDocument posts multipart `documents` field and returns the first entry', async () => {
		let observedField: FormDataEntryValue | null = null;
		let observedFilename = '';
		let observedKey = '';
		server.use(
			http.post(`${BASE}/api/documents/upload`, async ({ request }) => {
				observedKey = request.headers.get('x-api-key') ?? '';
				const fd = await request.formData();
				observedField = fd.get('documents');
				if (observedField instanceof File) observedFilename = observedField.name;
				return HttpResponse.json([
					{ name: 'pump-87432mi.jpg', location: '/documents/abc.jpg', isPending: false }
				]);
			})
		);
		const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
		const out = await client().uploadDocument(bytes, 'pump-87432mi.jpg');
		expect(observedKey).toBe(KEY);
		expect(observedField).toBeInstanceOf(File);
		expect(observedFilename).toBe('pump-87432mi.jpg');
		expect(out).toEqual({ name: 'pump-87432mi.jpg', location: '/documents/abc.jpg', isPending: false });
	});

	it('uploadDocument throws when upstream returns an empty array', async () => {
		server.use(http.post(`${BASE}/api/documents/upload`, () => HttpResponse.json([])));
		await expect(client().uploadDocument(new Uint8Array([0xff, 0xd8, 0xff]), 'x.jpg')).rejects.toMatchObject({ name: 'LubeLoggerError' });
	});

	it('addGasRecord with files sends the JSON variant (camelCase, nested files)', async () => {
		let observedCt = '';
		let observedBody: Record<string, unknown> = {};
		server.use(
			http.post(`${BASE}/api/vehicle/gasrecords/add`, async ({ request }) => {
				observedCt = request.headers.get('content-type') ?? '';
				observedBody = (await request.json()) as Record<string, unknown>;
				return HttpResponse.json({ success: true, message: 'Gas Record Added' });
			})
		);
		await client().addGasRecord(
			1,
			{
				date: '2026-05-29',
				odometer: '87432',
				fuelconsumed: '11.200',
				isfilltofull: 'true',
				missedfuelup: 'false',
				cost: '42.18',
				notes: 'n',
				tags: ''
			},
			[{ name: 'pump-87432mi.jpg', location: '/documents/abc.jpg', isPending: false }]
		);
		expect(observedCt).toContain('application/json');
		expect(observedBody).toMatchObject({
			date: '2026-05-29',
			odometer: '87432',
			fuelConsumed: '11.200',
			cost: '42.18',
			isFillToFull: 'true',
			missedFuelUp: 'false',
			notes: 'n',
			tags: '',
			files: [{ name: 'pump-87432mi.jpg', location: '/documents/abc.jpg', isPending: false }]
		});
	});

	it('addGasRecord without files keeps the flat multipart path', async () => {
		let observedCt = '';
		server.use(
			http.post(`${BASE}/api/vehicle/gasrecords/add`, async ({ request }) => {
				observedCt = request.headers.get('content-type') ?? '';
				await request.formData();
				return HttpResponse.text('OK');
			})
		);
		await client().addGasRecord(1, {
			date: '2026-05-29',
			odometer: '87432',
			fuelconsumed: '11.200',
			isfilltofull: 'true',
			missedfuelup: 'false',
			cost: '42.18'
		});
		expect(observedCt).toContain('multipart/form-data');
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
