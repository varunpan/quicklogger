import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEnv } from '$lib/server/env';
import { LubeLoggerClient, LubeLoggerError } from '$lib/server/lubelogger';
import { TtlCache } from '$lib/server/cache';
import { normalizeVehicleIdentifiers } from '$lib/server/vehicle-identifiers';

const cache = new TtlCache<unknown>(5 * 60 * 1000);

export function _resetCache() { cache.clear(); }

export const GET: RequestHandler = async () => {
  try {
    const env = loadEnv();
    const client = new LubeLoggerClient({
      baseUrl: env.lubeloggerUrl,
      apiKey: env.lubeloggerApiKey
    });
    const vehicles = await cache.get('vehicles', async () => {
      const raw = await client.listVehicles();
      return raw.map(normalizeVehicleIdentifiers);
    });
    return json(vehicles);
  } catch (err) {
    if (err instanceof LubeLoggerError) {
      return json({ error: err.message }, { status: 502 });
    }
    return json({ error: (err as Error).message }, { status: 500 });
  }
};
