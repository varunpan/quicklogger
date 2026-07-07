import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseVehicleId, withLubeLogger } from '$lib/server/lubeloggerProxy';

export const GET: RequestHandler = ({ url, locals }) => {
  const vehicleId = parseVehicleId(url);
  if (vehicleId instanceof Response) return vehicleId;

  return withLubeLogger(
    locals,
    { resource: 'vehicle info', logMessage: 'vehicle-info lookup failed' },
    async (client) => {
      const info = await client.getVehicleInfo(vehicleId);
      return json(info);
    }
  );
};
