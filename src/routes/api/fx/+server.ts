import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEnv } from '$lib/server/env';
import {
  CurrencyService,
  JsonFileStore,
  realFetcher,
  FxUnavailableError
} from '$lib/server/currency';
import { getLogger } from '$lib/server/logger';

let svc: CurrencyService | null = null;

// Process-level singleton, so it binds the root logger rather than a
// per-request child — otherwise the first request's `request_id` would be
// stamped on every later `fx provider failed` line (review #28).
function service() {
  if (svc) return svc;
  const env = loadEnv();
  svc = new CurrencyService({
    providers: env.fxProviders,
    fetcher: realFetcher,
    store: new JsonFileStore(env.fxCachePath),
    logger: getLogger()
  });
  return svc;
}

export function _resetForTests() { svc = null; }

export const GET: RequestHandler = async ({ url, locals }) => {
  const from = (url.searchParams.get('from') ?? '').toUpperCase();
  const to = (url.searchParams.get('to') ?? '').toUpperCase();
  if (!from || !to) return json({ error: 'from and to required' }, { status: 400 });
  // 3-letter ISO-4217 codes only — these values are interpolated into FX
  // provider URLs and persisted as fx-cache keys (see fuelup's mirror gate).
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
    return json({ error: 'from and to must be 3-letter currency codes' }, { status: 400 });
  }

  try {
    const rate = await service().getRate(from, to);
    return json(rate);
  } catch (err) {
    if (err instanceof FxUnavailableError) {
      return json({ available: false }, { status: 503 });
    }
    locals.logger.error('fx lookup failed', { err });
    return json({ error: 'unexpected server error' }, { status: 500 });
  }
};
