import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEnv } from '$lib/server/env';
import {
  CurrencyService,
  JsonFileStore,
  realFetcher,
  FxUnavailableError
} from '$lib/server/currency';

let svc: CurrencyService | null = null;

function service(logger?: import('$lib/server/logger').Logger) {
  if (svc) return svc;
  const env = loadEnv();
  svc = new CurrencyService({
    providers: env.fxProviders,
    fetcher: realFetcher,
    store: new JsonFileStore(env.fxCachePath),
    logger
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
    const rate = await service(locals.logger).getRate(from, to);
    return json(rate);
  } catch (err) {
    if (err instanceof FxUnavailableError) {
      return json({ available: false }, { status: 503 });
    }
    locals.logger.error('fx lookup failed', { err });
    return json({ error: 'unexpected server error' }, { status: 500 });
  }
};
