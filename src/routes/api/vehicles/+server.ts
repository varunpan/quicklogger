import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEnv } from '$lib/server/env';
import { LubeLoggerClient, LubeLoggerError } from '$lib/server/lubelogger';
import { getCachedVehicles, _resetVehicleCache } from '$lib/server/vehicleCache';

export function _resetCache() { _resetVehicleCache(); }

export const GET: RequestHandler = async ({ locals }) => {
  try {
    const env = loadEnv();
    const client = new LubeLoggerClient({
      baseUrl: env.lubeloggerUrl,
      apiKey: env.lubeloggerApiKey,
      logger: locals.logger
    });
    const vehicles = await getCachedVehicles(client);
    return json(vehicles);
  } catch (err) {
    if (err instanceof LubeLoggerError) {
      // Detail is logged at the throw site ('lubelogger non-ok').
      return json({ error: 'Could not fetch vehicles from LubeLogger' }, { status: 502 });
    }
    locals.logger.error('vehicles lookup failed', { err });
    return json({ error: 'unexpected server error' }, { status: 500 });
  }
};
