import { json } from '@sveltejs/kit';
import { loadEnv, type Env } from '$lib/server/env';
import { LubeLoggerClient, LubeLoggerError } from '$lib/server/lubelogger';
import type { Logger } from '$lib/server/logger';

/** Env-configured LubeLogger client plus the env it was built from — the one
 *  construction site for every route that talks upstream. */
export function lubeloggerFromEnv(logger: Logger): { client: LubeLoggerClient; env: Env } {
  const env = loadEnv();
  const client = new LubeLoggerClient({
    baseUrl: env.lubeloggerUrl,
    apiKey: env.lubeloggerApiKey,
    logger
  });
  return { client, env };
}

/** Parse the `?vehicleId=` query param shared by the vehicle GET proxies.
 *  Returns the id, or a ready-to-return 400 Response. Requires a positive
 *  integer — the same rule as /api/fuelup's validate(). The GET routes used
 *  to accept any finite number (`3.5`, `-2`), letting garbage reach the
 *  authenticated upstream URL. */
export function parseVehicleId(url: URL): number | Response {
  const raw = url.searchParams.get('vehicleId');
  if (!raw) return json({ error: 'vehicleId required' }, { status: 400 });
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'invalid vehicleId' }, { status: 400 });
  return id;
}

/** Shared happy-path/error envelope for the LubeLogger GET proxies: build the
 *  client, run `fn`, and map failures the way every proxy always has —
 *  LubeLoggerError → 502 `Could not fetch <resource> from LubeLogger`,
 *  anything else → logged `logMessage` + generic 500. */
export async function withLubeLogger(
  locals: { logger: Logger },
  labels: { resource: string; logMessage: string },
  fn: (client: LubeLoggerClient, env: Env) => Promise<Response>
): Promise<Response> {
  try {
    const { client, env } = lubeloggerFromEnv(locals.logger);
    return await fn(client, env);
  } catch (err) {
    if (err instanceof LubeLoggerError) {
      // Detail is logged at the throw site ('lubelogger non-ok').
      return json({ error: `Could not fetch ${labels.resource} from LubeLogger` }, { status: 502 });
    }
    locals.logger.error(labels.logMessage, { err });
    return json({ error: 'unexpected server error' }, { status: 500 });
  }
}
