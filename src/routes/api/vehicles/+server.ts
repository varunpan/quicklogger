import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withLubeLogger } from '$lib/server/lubeloggerProxy';
import { getCachedVehicles, _resetVehicleCache } from '$lib/server/vehicleCache';

export function _resetCache() {
  _resetVehicleCache();
}

export const GET: RequestHandler = ({ locals }) =>
  withLubeLogger(
    locals,
    { resource: 'vehicles', logMessage: 'vehicles lookup failed' },
    async (client) => {
      const vehicles = await getCachedVehicles(client);
      return json(vehicles);
    }
  );
