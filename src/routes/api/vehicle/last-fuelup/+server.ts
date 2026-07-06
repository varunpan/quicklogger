import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEnv } from '$lib/server/env';
import { LubeLoggerClient, LubeLoggerError, type GasRecord } from '$lib/server/lubelogger';

function parseDate(s: string): number {
  // Wire is ISO YYYY-MM-DD under culture-invariant: true.
  // Date.parse on bare ISO is spec-defined as UTC midnight — fine for
  // "latest record" comparison (we sort, not display).
  return Date.parse(s);
}

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
  } catch (err) {
    if (err instanceof LubeLoggerError) {
      // Detail is logged at the throw site ('lubelogger non-ok').
      return json({ error: 'Could not fetch last fuelup from LubeLogger' }, { status: 502 });
    }
    locals.logger.error('last-fuelup lookup failed', { err });
    return json({ error: 'unexpected server error' }, { status: 500 });
  }
};
