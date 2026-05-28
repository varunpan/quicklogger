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
    const latest = records.reduce((acc: GasRecord, r) => parseDate(r.date) > parseDate(acc.date) ? r : acc);
    return json(latest);
  } catch (err) {
    if (err instanceof LubeLoggerError) {
      return json(
        {
          error: 'Could not fetch last fuelup from LubeLogger',
          upstream: 'GET /api/vehicle/gasrecords',
          upstream_status: err.status
        },
        { status: 502 }
      );
    }
    return json({ error: (err as Error).message }, { status: 500 });
  }
};
