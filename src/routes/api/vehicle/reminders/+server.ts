import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEnv } from '$lib/server/env';
import { LubeLoggerClient, LubeLoggerError } from '$lib/server/lubelogger';

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
    const reminders = await client.listReminders(vehicleId);
    return json(reminders);
  } catch (err) {
    if (err instanceof LubeLoggerError) {
      return json({ error: err.message }, { status: 502 });
    }
    return json({ error: (err as Error).message }, { status: 500 });
  }
};
