import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEnv } from '$lib/server/env';
import { LubeLoggerClient, LubeLoggerError, type Vehicle } from '$lib/server/lubelogger';
import { TtlCache } from '$lib/server/cache';

const cache = new TtlCache<Vehicle[]>(5 * 60 * 1000);

export const GET: RequestHandler = async ({ params, fetch }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(400, 'invalid vehicle id');

	const env = loadEnv();
	const client = new LubeLoggerClient({
		baseUrl: env.lubeloggerUrl,
		apiKey: env.lubeloggerApiKey
	});

	let vehicles: Vehicle[];
	try {
		vehicles = await cache.get('vehicles', () => client.listVehicles());
	} catch (err) {
		if (err instanceof LubeLoggerError) error(502, err.message);
		throw err;
	}

	const vehicle = vehicles.find((v) => v.id === id);
	if (!vehicle?.imageLocation) error(404, 'no image');

	const imgRes = await fetch(`${env.lubeloggerUrl}${vehicle.imageLocation}`, {
		headers: { 'x-api-key': env.lubeloggerApiKey }
	});
	if (!imgRes.ok || !imgRes.body) error(imgRes.status === 404 ? 404 : 502, 'image fetch failed');

	return new Response(imgRes.body, {
		status: 200,
		headers: {
			'content-type': imgRes.headers.get('content-type') || 'image/jpeg',
			'cache-control': 'private, max-age=86400'
		}
	});
};
