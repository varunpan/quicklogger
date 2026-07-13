import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEnv } from '$lib/server/env';
import { LubeLoggerClient } from '$lib/server/lubelogger';

export const GET: RequestHandler = async ({ locals }) => {
  try {
    const env = loadEnv();
    const client = new LubeLoggerClient({
      baseUrl: env.lubeloggerUrl,
      apiKey: env.lubeloggerApiKey,
      timeoutMs: 2_000
    });
    await client.listVehicles();
    return json({ ok: true });
  } catch (err) {
    // Generic message only — a LubeLoggerError's message embeds the upstream
    // status and a 200-char body preview, and this endpoint is unauthenticated
    // (residual of review #16). The real cause goes to the server log instead.
    locals.logger.warn('healthz upstream check failed', { err });
    return json({ ok: false, error: 'upstream unreachable' }, { status: 503 });
  }
};
