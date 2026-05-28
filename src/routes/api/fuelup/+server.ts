import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEnv } from '$lib/server/env';
import { LubeLoggerClient, LubeLoggerError } from '$lib/server/lubelogger';
import { CurrencyService, JsonFileStore, realFetcher } from '$lib/server/currency';
import { convertSubmission } from '$lib/server/convert';
import type { FuelSubmissionInput } from '$lib/shared/types';

let cur: CurrencyService | null = null;
const idempotencyMap = new Map<string, { ts: number; result: Response }>();
const IDEMPOTENCY_WINDOW_MS = 60_000;

function currency(logger?: import('$lib/server/logger').Logger) {
  if (cur) return cur;
  const env = loadEnv();
  cur = new CurrencyService({
    providers: env.fxProviders,
    fetcher: realFetcher,
    store: new JsonFileStore(env.fxCachePath),
    logger
  });
  return cur;
}

export function _resetForTests() {
  cur = null;
  idempotencyMap.clear();
}

async function parseBody(req: Request): Promise<Partial<FuelSubmissionInput>> {
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    return (await req.json()) as Partial<FuelSubmissionInput>;
  }
  if (ct.includes('application/x-www-form-urlencoded')) {
    const text = await req.text();
    const usp = new URLSearchParams(text);
    return coerceParams(usp);
  }
  if (ct.includes('multipart/form-data')) {
    const fd = await req.formData();
    return coerceParams(fd);
  }
  throw new Error(`unsupported content-type: ${ct}`);
}

function coerceParams(src: URLSearchParams | FormData): Partial<FuelSubmissionInput> {
  const get = (k: string): string | undefined => {
    const v = src.get(k);
    return v == null ? undefined : String(v);
  };
  return {
    vehicleId: get('vehicleId') !== undefined ? Number(get('vehicleId')) : undefined,
    date: get('date'),
    odometer: get('odometer') !== undefined ? Number(get('odometer')) : undefined,
    volume: get('volume') !== undefined ? Number(get('volume')) : undefined,
    volumeUnit: get('volumeUnit') as 'gal' | 'L' | undefined,
    cost: get('cost') !== undefined ? Number(get('cost')) : undefined,
    currency: get('currency'),
    isFillToFull: get('isFillToFull') === 'true',
    missedFuelup: get('missedFuelup') === 'true',
    notes: get('notes'),
    tags: get('tags'),
    manualFxRate: get('manualFxRate') !== undefined ? Number(get('manualFxRate')) : undefined,
    clientSubmissionId: get('clientSubmissionId')
  };
}

function validate(b: Partial<FuelSubmissionInput>): asserts b is FuelSubmissionInput {
  const missing: string[] = [];
  for (const k of ['vehicleId', 'date', 'odometer', 'volume', 'volumeUnit', 'cost', 'currency', 'clientSubmissionId'] as const) {
    if (b[k] === undefined || b[k] === null) missing.push(k);
  }
  if (missing.length) throw new Error(`missing fields: ${missing.join(', ')}`);

  // Numeric fields must be finite and strictly positive — a zero odometer,
  // zero volume, or zero cost is never a real fuelup. Apple Shortcuts and
  // direct API consumers bypass the form's own gate, so this is the only
  // line of defense for them.
  const positives = ['odometer', 'volume', 'cost'] as const;
  const invalid: string[] = [];
  for (const k of positives) {
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n <= 0) invalid.push(k);
  }
  if (typeof b.date !== 'string' || b.date.trim() === '') invalid.push('date');
  if (invalid.length) throw new Error(`invalid fields (must be > 0 / non-empty): ${invalid.join(', ')}`);
}

async function cloneJsonResponse(res: Response): Promise<Response> {
  const body = await res.clone().text();
  return new Response(body, {
    status: res.status,
    headers: { 'content-type': 'application/json' }
  });
}

export const POST: RequestHandler = async ({ request, locals }) => {
  let parsed: Partial<FuelSubmissionInput>;
  try {
    parsed = await parseBody(request);
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 400 });
  }

  try {
    validate(parsed);
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 400 });
  }
  const input = parsed as FuelSubmissionInput;

  const now = Date.now();
  for (const [k, v] of idempotencyMap) {
    if (now - v.ts > IDEMPOTENCY_WINDOW_MS) idempotencyMap.delete(k);
  }
  const cached = idempotencyMap.get(input.clientSubmissionId);
  if (cached) return cloneJsonResponse(cached.result);

  try {
    const env = loadEnv();
    const conv = await convertSubmission(
      {
        volume: input.volume,
        volumeUnit: input.volumeUnit,
        cost: input.cost,
        currency: input.currency,
        manualFxRate: input.manualFxRate
      },
      {
        targetVolumeUnit: env.lubeloggerVolumeUnit,
        targetCurrency: env.lubeloggerCurrency,
        currencyService: currency(locals.logger)
      }
    );

    const client = new LubeLoggerClient({
      baseUrl: env.lubeloggerUrl,
      apiKey: env.lubeloggerApiKey,
      logger: locals.logger
    });
    await client.addGasRecord(input.vehicleId, {
      date: input.date,                          // ISO YYYY-MM-DD; LubeLogger parses under culture-invariant
      odometer: String(input.odometer),
      fuelconsumed: conv.gallons.toFixed(3),
      isfilltofull: input.isFillToFull ? 'true' : 'false',
      missedfuelup: input.missedFuelup ? 'true' : 'false',
      cost: conv.cost.toFixed(2),
      notes: input.notes,
      tags: input.tags
    });

    const success = json({
      ok: true,
      submitted: {
        gallons: conv.gallons,
        cost: conv.cost,
        fxRate: conv.fxRate,
        fxSource: conv.fxSource,
        fxStale: conv.fxStale
      }
    });
    idempotencyMap.set(input.clientSubmissionId, { ts: Date.now(), result: success });
    return success.clone();
  } catch (err) {
    if (err instanceof LubeLoggerError) {
      return json(
        {
          error: 'Could not submit fillup to LubeLogger',
          upstream: 'POST /api/vehicle/gasrecords/add',
          upstream_status: err.status,
          upstream_body_preview: err.body.slice(0, 200)
        },
        { status: err.status >= 500 ? 502 : err.status }
      );
    }
    return json({ error: (err as Error).message }, { status: 500 });
  }
};
