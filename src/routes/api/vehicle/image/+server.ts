import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEnv } from '$lib/server/env';
import { LubeLoggerClient, LubeLoggerError, type Vehicle } from '$lib/server/lubelogger';
import { TtlCache } from '$lib/server/cache';

const cache = new TtlCache<Vehicle[]>(5 * 60 * 1000);

export function _resetCache() { cache.clear(); }

export const GET: RequestHandler = async ({ url }) => {
  const vehicleIdRaw = url.searchParams.get('vehicleId');
  if (!vehicleIdRaw) return json({ error: 'vehicleId required' }, { status: 400 });
  const vehicleId = Number(vehicleIdRaw);
  if (!Number.isFinite(vehicleId)) return json({ error: 'invalid vehicleId' }, { status: 400 });

  try {
    const env = loadEnv();
    const client = new LubeLoggerClient({
      baseUrl: env.lubeloggerUrl,
      apiKey: env.lubeloggerApiKey
    });
    const vehicles = await cache.get('vehicles', () => client.listVehicles());
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
      return json({ error: err.message }, { status: 502 });
    }
    return json({ error: (err as Error).message }, { status: 500 });
  }
};
