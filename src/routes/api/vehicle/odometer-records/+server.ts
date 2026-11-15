import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseVehicleId, withLubeLogger } from '$lib/server/lubeloggerProxy';

/**
 * The vehicle's odometer records, trimmed to what /history needs to label a
 * fill-up with the equipment LubeLogger credited it to: `{ date, odometer,
 * equipmentIds }`. LubeLogger credits equipment on the odometer record it
 * auto-inserts for each fill-up, so this is the only truthful source (whether
 * auto-insert is on isn't visible to quicklogger).
 */
export const GET: RequestHandler = ({ url, locals }) => {
  const vehicleId = parseVehicleId(url);
  if (vehicleId instanceof Response) return vehicleId;

  return withLubeLogger(
    locals,
    { resource: 'odometer records', logMessage: 'odometer records lookup failed' },
    async (client) => {
      const records = await client.listOdometerRecords(vehicleId);
      return json(
        records.map((r) => ({ date: r.date, odometer: r.odometer, equipmentIds: r.equipmentIds }))
      );
    }
  );
};
