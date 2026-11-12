import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseVehicleId, withLubeLogger } from '$lib/server/lubeloggerProxy';

export const GET: RequestHandler = ({ url, locals }) => {
  const vehicleId = parseVehicleId(url);
  if (vehicleId instanceof Response) return vehicleId;

  return withLubeLogger(
    locals,
    { resource: 'equipment', logMessage: 'equipment lookup failed' },
    async (client) => {
      const equipment = await client.listEquipment(vehicleId);
      return json(equipment);
    }
  );
};
