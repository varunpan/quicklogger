import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEnv } from '$lib/server/env';
import { LubeLoggerClient, LubeLoggerError } from '$lib/server/lubelogger';
import type { UploadedFile } from '$lib/server/lubelogger';
import { sniffImageType } from '$lib/server/ocr';
import { CurrencyService, JsonFileStore, realFetcher } from '$lib/server/currency';
import { convertSubmission } from '$lib/server/convert';
import type { FuelSubmissionInput } from '$lib/shared/types';

let cur: CurrencyService | null = null;

// A submission's serialized outcome, shared among concurrent duplicate submits
// via the idempotency map. We store the serialized form (not a `Response`)
// because a `Response` body is single-use — concurrent waiters each need to
// build their own fresh `Response` from the same bytes.
type SubmitResult = { status: number; body: string };
const idempotencyMap = new Map<string, { ts: number; promise: Promise<SubmitResult> }>();
const IDEMPOTENCY_WINDOW_MS = 60_000;

// Server-side diagnostic string for a photo that didn't attach. Not
// user-facing — the client maps any truthy `photoWarning` to one fixed toast.
const PHOTO_WARNING = 'one or more photos could not be attached';

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

interface ParsedBody {
  input: Partial<FuelSubmissionInput>;
  images: { pump: File | null; odometer: File | null };
}

async function parseBody(req: Request): Promise<ParsedBody> {
  const ct = req.headers.get('content-type') ?? '';
  const noImages = { pump: null, odometer: null };
  if (ct.includes('application/json')) {
    return { input: (await req.json()) as Partial<FuelSubmissionInput>, images: noImages };
  }
  if (ct.includes('application/x-www-form-urlencoded')) {
    const text = await req.text();
    const usp = new URLSearchParams(text);
    return { input: coerceParams(usp), images: noImages };
  }
  if (ct.includes('multipart/form-data')) {
    const fd = await req.formData();
    const pump = fd.get('pumpImage');
    const odometer = fd.get('odometerImage');
    return {
      input: coerceParams(fd),
      images: {
        pump: pump instanceof File && pump.size > 0 ? pump : null,
        odometer: odometer instanceof File && odometer.size > 0 ? odometer : null
      }
    };
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

  const invalid: string[] = [];
  // vehicleId must be a positive integer, coerced before use. The form path
  // already coerces with Number(), but the JSON path delivers whatever the
  // client sent — a string would otherwise be interpolated raw into the
  // authenticated upstream URL (query injection) or reach LubeLogger as NaN
  // after a full FX+upload run.
  const vid = Number(b.vehicleId);
  if (!Number.isInteger(vid) || vid <= 0) invalid.push('vehicleId');
  else b.vehicleId = vid;

  // volumeUnit is a closed enum. Anything else (e.g. 'liters') used to sail
  // through to toGallons() and surface as a 500 — a 400-class input error.
  if (b.volumeUnit !== 'gal' && b.volumeUnit !== 'L') invalid.push('volumeUnit');

  // currency must be a 3-letter ISO-4217 code, normalized to uppercase. Raw
  // values flow into FX provider URLs and become persistent fx-cache keys,
  // so this is the only gate against URL injection and unbounded cache keys
  // (':' inside a code would also collide the `from:to` key format).
  const cur = String(b.currency ?? '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) invalid.push('currency');
  else b.currency = cur;

  // Numeric fields must be finite and strictly positive — a zero odometer,
  // zero volume, or zero cost is never a real fuelup. Apple Shortcuts and
  // direct API consumers bypass the form's own gate, so this is the only
  // line of defense for them. Valid values are coerced onto the body: the
  // JSON path can deliver numeric *strings*, and downstream `.toFixed()`
  // calls must always see numbers.
  const positives = ['odometer', 'volume', 'cost'] as const;
  for (const k of positives) {
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n <= 0) invalid.push(k);
    else b[k] = n;
  }
  if (typeof b.date !== 'string' || b.date.trim() === '') invalid.push('date');
  // manualFxRate is optional, but when present it must be a positive finite
  // number — otherwise `cost = cost * fxRate` (convert.ts) writes NaN/0/negative
  // straight to the LubeLogger record. This is the only gate: the form's
  // canSubmit doesn't check it, and API/Shortcuts consumers bypass the form.
  if (b.manualFxRate !== undefined && (!Number.isFinite(b.manualFxRate) || b.manualFxRate <= 0)) {
    invalid.push('manualFxRate');
  }
  if (invalid.length) throw new Error(`invalid fields (must be > 0 / non-empty): ${invalid.join(', ')}`);
}

function jsonResponse(r: SubmitResult): Response {
  return new Response(r.body, {
    status: r.status,
    headers: { 'content-type': 'application/json' }
  });
}

/** Belt-and-suspenders: ensure unique upload filenames. The `pump-` / `odometer-`
 *  prefixes already differ, so this never triggers in practice — included as an
 *  invariant guard only. Mutates each item's `name` in place. */
function dedupeFilenames(items: Array<{ name: string }>): void {
  const seen = new Set<string>();
  for (const it of items) {
    if (!seen.has(it.name)) { seen.add(it.name); continue; }
    const dot = it.name.lastIndexOf('.');
    const base = dot === -1 ? it.name : it.name.slice(0, dot);
    const ext = dot === -1 ? '' : it.name.slice(dot);
    let n = 2;
    while (seen.has(`${base}-${n}${ext}`)) n++;
    it.name = `${base}-${n}${ext}`;
    seen.add(it.name);
  }
}

/** The actual upstream work for one submission: FX/units conversion, optional
 *  photo uploads, and the gas-record write. **Never throws** — upstream and
 *  unexpected errors are converted to the same JSON error payloads the endpoint
 *  has always returned. Returning a serializable result (not a `Response`) is
 *  what lets the idempotency map share one outcome across concurrent duplicate
 *  submits without a single-use body getting in the way. */
async function submitToLubeLogger(
  input: FuelSubmissionInput,
  images: { pump: File | null; odometer: File | null },
  logger: import('$lib/server/logger').Logger
): Promise<SubmitResult> {
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
        currencyService: currency(logger)
      }
    );

    const client = new LubeLoggerClient({
      baseUrl: env.lubeloggerUrl,
      apiKey: env.lubeloggerApiKey,
      logger
    });
    const payload = {
      date: input.date,                          // ISO YYYY-MM-DD; LubeLogger parses under culture-invariant
      odometer: String(input.odometer),
      fuelconsumed: conv.gallons.toFixed(3),
      isfilltofull: input.isFillToFull ? 'true' : 'false',
      missedfuelup: input.missedFuelup ? 'true' : 'false',
      cost: conv.cost.toFixed(2),
      notes: input.notes,
      tags: input.tags
    };

    // Upload step (record-first). Only images that pass the part-level gates
    // are uploaded; a gate failure or an upload error skips that file and
    // sets photoWarning — it never fails the fuelup. These are OCR-resized
    // ~200 KB JPEGs, so the size/sniff gate won't trigger in practice, but we
    // guard rather than push garbage upstream.
    const files: UploadedFile[] = [];
    let photoWarning: string | undefined;
    const toUpload: Array<{ file: File; name: string }> = [];
    if (images.pump) toUpload.push({ file: images.pump, name: `pump-${input.odometer}mi.jpg` });
    if (images.odometer) toUpload.push({ file: images.odometer, name: `odometer-${input.odometer}mi.jpg` });
    dedupeFilenames(toUpload);
    for (const u of toUpload) {
      const bytes = new Uint8Array(await u.file.arrayBuffer());
      const sniffed = sniffImageType(bytes);
      if (bytes.byteLength > env.ocrMaxImageBytes || sniffed === null) {
        logger.warn('fuelup photo skipped (failed part gate)', {
          name: u.name,
          bytes: bytes.byteLength,
          sniffed
        });
        photoWarning = PHOTO_WARNING;
        continue;
      }
      try {
        files.push(await client.uploadDocument(bytes, u.name));
      } catch (err) {
        logger.warn('fuelup photo upload failed', { name: u.name, err });
        photoWarning = PHOTO_WARNING;
      }
    }

    await client.addGasRecord(input.vehicleId, payload, files);

    return {
      status: 200,
      body: JSON.stringify({
        ok: true,
        submitted: {
          gallons: conv.gallons,
          cost: conv.cost,
          fxRate: conv.fxRate,
          fxSource: conv.fxSource,
          fxStale: conv.fxStale
        },
        ...(photoWarning ? { photoWarning } : {})
      })
    };
  } catch (err) {
    if (err instanceof LubeLoggerError) {
      return {
        status: err.status >= 500 ? 502 : err.status,
        body: JSON.stringify({
          error: 'Could not submit fillup to LubeLogger',
          upstream: 'POST /api/vehicle/gasrecords/add',
          upstream_status: err.status,
          upstream_body_preview: err.body.slice(0, 200)
        })
      };
    }
    return { status: 500, body: JSON.stringify({ error: (err as Error).message }) };
  }
}

export const POST: RequestHandler = async ({ request, locals }) => {
  let parsed: Partial<FuelSubmissionInput>;
  let images: { pump: File | null; odometer: File | null };
  try {
    const body = await parseBody(request);
    parsed = body.input;
    images = body.images;
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

  // Dedup a duplicate submit (same clientSubmissionId) against either an
  // in-flight request or one completed within the window. Registering the
  // pending promise BEFORE awaiting upstream — the synchronous `set` below,
  // ahead of any `await` — is what closes the concurrent-double-submit race
  // (a double-tap, or the SW queue replay racing the foreground submit). Two
  // near-simultaneous duplicates now await and share one upstream write
  // instead of both POSTing and creating two records.
  const existing = idempotencyMap.get(input.clientSubmissionId);
  if (existing) return jsonResponse(await existing.promise);

  const promise = submitToLubeLogger(input, images, locals.logger);
  idempotencyMap.set(input.clientSubmissionId, { ts: now, promise });

  const result = await promise;
  // Keep a success cached for the rest of the window so a later resubmit is a
  // no-op; drop a failure (no record was created) so a genuine retry can reach
  // upstream.
  if (result.status >= 200 && result.status < 300) {
    idempotencyMap.set(input.clientSubmissionId, { ts: Date.now(), promise });
  } else {
    idempotencyMap.delete(input.clientSubmissionId);
  }
  return jsonResponse(result);
};
