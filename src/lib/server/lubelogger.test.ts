import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { LubeLoggerClient } from './lubelogger';

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
});
