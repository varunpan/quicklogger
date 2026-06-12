import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEnv } from '$lib/server/env';
import { LubeLoggerClient, LubeLoggerError } from '$lib/server/lubelogger';
import { getCachedVehicles, _resetVehicleCache } from '$lib/server/vehicleCache';

export function _resetCache() { _resetVehicleCache(); }

export const GET: RequestHandler = async ({ url, locals }) => {
  const vehicleIdRaw = url.searchParams.get('vehicleId');
  if (!vehicleIdRaw) return json({ error: 'vehicleId required' }, { status: 400 });
  const vehicleId = Number(vehicleIdRaw);
  if (!Number.isFinite(vehicleId)) return json({ error: 'invalid vehicleId' }, { status: 400 });

  try {
    const env = loadEnv();
    const client = new LubeLoggerClient({
      baseUrl: env.lubeloggerUrl,
      apiKey: env.lubeloggerApiKey,
      logger: locals.logger
    });
    const vehicles = await getCachedVehicles(client);
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) return json({ error: 'no image' }, { status: 404 });

    const path = (vehicle as { imageLocation?: unknown }).imageLocation;
    if (typeof path !== 'string' || path === '') {
      return json({ error: 'no image' }, { status: 404 });
    }
    if (!path.startsWith('/images/')) {
      return json({ error: 'no image' }, { status: 404 });
    }

    const upstream = await client.fetchImage(path);
    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control': 'no-store'
      }
    });
  } catch (err) {
    if (err instanceof LubeLoggerError) {
      // Detail is logged at the throw site ('lubelogger non-ok').
      return json({ error: 'Could not fetch vehicle image from LubeLogger' }, { status: 502 });
    }
    locals.logger.error('vehicle image fetch failed', { err });
    return json({ error: 'unexpected server error' }, { status: 500 });
  }
};
