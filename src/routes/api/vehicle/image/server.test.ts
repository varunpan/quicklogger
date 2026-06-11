// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { GET, _resetCache } from './+server';

const upstream = setupServer();
beforeAll(() => upstream.listen({ onUnhandledRequest: 'error' }));
afterEach(() => upstream.resetHandlers());
afterAll(() => upstream.close());

beforeAll(() => {
	process.env.LUBELOGGER_URL = 'http://lubelog:8080';
	process.env.LUBELOGGER_API_KEY = 'k';
});

beforeEach(() => _resetCache());

const noopLogger = {
	debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
	child() { return this; }
} as unknown as import('$lib/server/logger').Logger;

function eventFor(vehicleId?: string) {
	const u = new URL('http://localhost/api/vehicle/image');
	if (vehicleId !== undefined) u.searchParams.set('vehicleId', vehicleId);
	return { url: u, locals: { logger: noopLogger, requestId: 't' } } as unknown as Parameters<typeof GET>[0];
}

const VEHICLES = [
	{ id: 1, year: 2014, make: 'Honda', model: 'Accord', imageLocation: '/images/abc-123.jpg' },
	{ id: 2, year: 2019, make: 'Honda', model: 'Civic', imageLocation: '' },
	{ id: 3, year: 2021, make: 'Honda', model: 'CR-V', imageLocation: 'http://evil.example/x.jpg' }
];

describe('GET /api/vehicle/image', () => {
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

	it('returns 404 when vehicle id not in list', async () => {
		upstream.use(
			http.get('http://lubelog:8080/api/vehicles', () => HttpResponse.json(VEHICLES))
		);
		const res = await GET(eventFor('999'));
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'no image' });
	});

	it('returns 404 when imageLocation is empty string', async () => {
		upstream.use(
			http.get('http://lubelog:8080/api/vehicles', () => HttpResponse.json(VEHICLES))
		);
		const res = await GET(eventFor('2'));
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'no image' });
	});

	it('returns 404 when imageLocation does not start with /images/ (path guard)', async () => {
		upstream.use(
			http.get('http://lubelog:8080/api/vehicles', () => HttpResponse.json(VEHICLES))
		);
		const res = await GET(eventFor('3'));
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'no image' });
	});

	it('streams the image with copied content-type and cache-control: no-store on happy path', async () => {
		const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8]);
		upstream.use(
			http.get('http://lubelog:8080/api/vehicles', () => HttpResponse.json(VEHICLES)),
			http.get('http://lubelog:8080/images/abc-123.jpg', () =>
				new HttpResponse(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } })
			)
		);
		const res = await GET(eventFor('1'));
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/jpeg');
		expect(res.headers.get('cache-control')).toBe('no-store');
		const body = new Uint8Array(await res.arrayBuffer());
		expect(body).toEqual(bytes);
	});

	it('returns 502 when LubeLogger returns 5xx on the image fetch', async () => {
		upstream.use(
			http.get('http://lubelog:8080/api/vehicles', () => HttpResponse.json(VEHICLES)),
			http.get('http://lubelog:8080/images/abc-123.jpg', () => new HttpResponse(null, { status: 503 }))
		);
		const res = await GET(eventFor('1'));
		expect(res.status).toBe(502);
	});

	it('returns 502 when LubeLogger returns 5xx on the vehicles lookup', async () => {
		upstream.use(
			http.get('http://lubelog:8080/api/vehicles', () => new HttpResponse(null, { status: 503 }))
		);
		const res = await GET(eventFor('1'));
		expect(res.status).toBe(502);
	});

	it('returns a generic error body on LubeLogger non-OK — no upstream details leak', async () => {
		upstream.use(
			http.get('http://lubelog:8080/api/vehicles', () => new HttpResponse('boom', { status: 503 }))
		);
		const res = await GET(eventFor('1'));
		expect(res.status).toBe(502);
		// Upstream topology/status stays in server logs ('lubelogger non-ok').
		expect(await res.json()).toEqual({ error: 'Could not fetch vehicle image from LubeLogger' });
	});

	it('caches the vehicles list — second call within window does not re-hit /api/vehicles', async () => {
		const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
		let vehiclesCalls = 0;
		upstream.use(
			http.get('http://lubelog:8080/api/vehicles', () => {
				vehiclesCalls++;
				return HttpResponse.json(VEHICLES);
			}),
			http.get('http://lubelog:8080/images/abc-123.jpg', () =>
				new HttpResponse(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } })
			)
		);
		await GET(eventFor('1'));
		await GET(eventFor('1'));
		await GET(eventFor('1'));
		expect(vehiclesCalls).toBe(1);
	});
});
