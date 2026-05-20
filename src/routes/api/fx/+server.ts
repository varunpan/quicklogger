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

  try {
    const rate = await service(locals.logger).getRate(from, to);
    return json(rate);
  } catch (err) {
    if (err instanceof FxUnavailableError) {
      return json({ available: false }, { status: 503 });
    }
    return json({ error: (err as Error).message }, { status: 500 });
  }
};
