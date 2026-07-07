import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseVehicleId, withLubeLogger } from '$lib/server/lubeloggerProxy';
import type { GasRecord } from '$lib/server/lubelogger';

function parseDate(s: string): number {
  // Wire is ISO YYYY-MM-DD under culture-invariant: true.
  // Date.parse on bare ISO is spec-defined as UTC midnight — fine for
  // "latest record" comparison (we sort, not display).
  return Date.parse(s);
}

export const GET: RequestHandler = ({ url, locals }) => {
  const vehicleId = parseVehicleId(url);
  if (vehicleId instanceof Response) return vehicleId;

  return withLubeLogger(
    locals,
    { resource: 'last fuelup', logMessage: 'last-fuelup lookup failed' },
    async (client) => {
      const records = await client.listGasRecords(vehicleId);
      if (records.length === 0) return json(null);
      const latest = records.reduce((acc: GasRecord, r) => {
        const dr = parseDate(r.date);
        const da = parseDate(acc.date);
        if (dr !== da) return dr > da ? r : acc;
        // Same-day tie: day-resolution dates can't order two fillups on the
        // same date, and a strict `>` alone kept whichever came first in the
        // array — the *earlier* record with LubeLogger's ordering. The later
        // fillup always has the larger odometer, so prefer it (Number() guards
        // against upstream builds serializing numerics as strings); on a full
        // tie `>=` keeps the later array entry.
        return Number(r.odometer) >= Number(acc.odometer) ? r : acc;
      });
      return json(latest);
    }
  );
};
