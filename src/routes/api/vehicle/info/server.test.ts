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
	debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
	child() { return this; }
} as unknown as import('$lib/server/logger').Logger;

function eventFor(vehicleId?: string) {
	const u = new URL('http://localhost/api/vehicle/info');
	if (vehicleId !== undefined) u.searchParams.set('vehicleId', vehicleId);
	return { url: u, locals: { logger: noopLogger, requestId: 't' } } as unknown as Parameters<typeof GET>[0];
}

const INFO = {
	vehicleData: { id: 1, year: 2014, make: 'Honda', model: 'Accord' },
	gasRecordCount: 22, gasRecordCost: 707.39,
	serviceRecordCount: 44, serviceRecordCost: 4164.2,
	repairRecordCount: 9, repairRecordCost: 1018.24,
	upgradeRecordCount: 1, upgradeRecordCost: 595,
	taxRecordCount: 0, taxRecordCost: 0,
	lastReportedOdometer: 111180,
	pastDueReminderCount: 2, veryUrgentReminderCount: 0,
	urgentReminderCount: 0, notUrgentReminderCount: 7,
	nextReminder: null
};

describe('GET /api/vehicle/info', () => {
	it('returns 400 when vehicleId is missing', async () => {
		const res = await GET(eventFor());
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'vehicleId required' });
	});

	it('returns 400 when vehicleId is not finite', async () => {
		const res = await GET(eventFor('not-a-number'));
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'invalid vehicleId' });
	});

	it('unwraps the 1-element array and returns the aggregate object on happy path', async () => {
		upstream.use(
			http.get('http://lubelog:8080/api/vehicle/info', () => HttpResponse.json([INFO]))
		);
		const res = await GET(eventFor('1'));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body)).toBe(false);
		expect(body.vehicleData.id).toBe(1);
		expect(body.gasRecordCost).toBe(707.39);
	});

	it('returns 502 when LubeLogger returns 5xx', async () => {
		upstream.use(
			http.get('http://lubelog:8080/api/vehicle/info', () => new HttpResponse(null, { status: 503 }))
		);
		const res = await GET(eventFor('1'));
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({ error: 'Could not fetch vehicle info from LubeLogger' });
	});

	it('returns 502 when LubeLogger returns an empty array', async () => {
		upstream.use(
			http.get('http://lubelog:8080/api/vehicle/info', () => HttpResponse.json([]))
		);
		const res = await GET(eventFor('1'));
		expect(res.status).toBe(502);
	});

	it('returns 500 when the upstream body is not JSON (non-LubeLoggerError)', async () => {
		upstream.use(
			http.get('http://lubelog:8080/api/vehicle/info', () =>
				new HttpResponse('not json', { status: 200, headers: { 'content-type': 'text/plain' } })
			)
		);
		const res = await GET(eventFor('1'));
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ error: 'unexpected server error' });
	});
});
