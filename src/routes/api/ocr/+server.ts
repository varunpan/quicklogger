import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEnv, type Env, type OcrSlotName } from '$lib/server/env';
import { selectProvider, runOcrPipeline, modelForSlot } from '$lib/server/ocr';
import { ChainOcrProvider } from '$lib/server/ocrProviders';
import { OcrRateLimiter } from '$lib/server/ocrRateLimit';
import { OcrBudget, JsonFileBudgetStore } from '$lib/server/ocrBudget';
import { OcrAudit, hashIp, hashImage, resolveAuditHmacKey } from '$lib/server/ocrAudit';
import type { OcrMode, OcrStatus } from '$lib/shared/types';

const AUDIT_MAX_BYTES = 10 * 1024 * 1024;       // 10 MiB JSONL rotation

// Multipart envelope overhead (boundaries + part headers + the handful of
// small text fields). A generous fixed allowance so an honest-sized image is
// never rejected by the early Content-Length guard below.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

let rateLimiter: OcrRateLimiter | null = null;
let budget: OcrBudget | null = null;
let audit: OcrAudit | null = null;
let hmacKey: Buffer | null = null;

function bootstrap(env: Env, logger?: import('$lib/server/logger').Logger) {
  if (rateLimiter && budget && audit && hmacKey) return;
  rateLimiter = new OcrRateLimiter({ perHour: env.ocrRateLimitPerHour, logger });
  budget = new OcrBudget({
    dailyUsd: env.ocrDailyBudgetUsd,
    store: new JsonFileBudgetStore(env.ocrBudgetPath),
    logger
  });
  audit = new OcrAudit({ path: env.ocrAuditPath, maxBytes: AUDIT_MAX_BYTES, logger });
  hmacKey = resolveAuditHmacKey({
    ocrAuditHmacKey: env.ocrAuditHmacKey,
    ocrAuditKeyPath: env.ocrAuditKeyPath,
    logger
  });
}

export function _resetForTests() {
  rateLimiter = null; budget = null; audit = null; hmacKey = null;
}

const ADVERTISED_MODES: OcrMode[] = ['pump', 'odometer'];
const ACCEPTED_WIRE_MODES = new Set<string>(['pump', 'odometer']);

export const GET: RequestHandler = async ({ locals }) => {
  const env = loadEnv();
  const { provider, chainTimeoutMs } = selectProvider(env, locals.logger);
  const body: OcrStatus = provider
    ? { enabled: true, modes: ADVERTISED_MODES, chainTimeoutMs }
    : { enabled: false };
  return json(body);
};

export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
  const env = loadEnv();
  bootstrap(env, locals.logger);
  const { provider } = selectProvider(env, locals.logger);
  if (!provider) return json({ error: 'OCR not configured' }, { status: 503 });

  const ip = getClientAddress();
  const rl = rateLimiter!.check(ip);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: 'rate limit reached', retryAfter: rl.retryAfterSec }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': String(rl.retryAfterSec)
        }
      }
    );
  }

  const budgetState = await budget!.check();
  if (!budgetState.ok) {
    return json({ error: 'daily OCR budget exceeded' }, { status: 402 });
  }

  // Early, best-effort size guard: reject obviously-too-large uploads from the
  // Content-Length header before `formData()` buffers the whole body into
  // memory. The authoritative gate is the post-parse `file.size` check below;
  // clients that omit or lie about Content-Length simply fall through to it.
  if (_contentLengthExceeds(request.headers.get('content-length'), env.ocrMaxImageBytes)) {
    return json({ error: `image must be <= ${env.ocrMaxImageBytes} bytes` }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    // Log the real reason — `request.formData()` swallowing its cause is what
    // sent v0.2.3/v0.2.4 chasing client-side theories. The actual cause was a
    // transport body cap truncating the stream; with BODY_SIZE_LIMIT=Infinity that
    // is gone, but any future genuine parse failure now records why.
    locals.logger.warn('ocr multipart parse failed', {
      err: err instanceof Error ? err.message : String(err),
      contentType: request.headers.get('content-type'),
      contentLength: request.headers.get('content-length')
    });
    return json({ error: 'multipart parse failed' }, { status: 400 });
  }

  const modeRaw = form.get('mode');
  if (typeof modeRaw !== 'string') {
    return json({ error: 'mode is required' }, { status: 400 });
  }
  if (!ACCEPTED_WIRE_MODES.has(modeRaw)) {
    return json({ error: `unknown mode: ${modeRaw}` }, { status: 400 });
  }
  const mode = modeRaw as OcrMode;

  // Optional rotation form field — accepts "0" | "90" | "180" | "270".
  // Anything else (including unset) collapses to 0. Wire-additive, never
  // user-visible — only recorded in the audit log so we can later answer
  // "do photos requiring rotation OCR worse?".
  const rotationRaw = form.get('rotation');
  const rotationParsed = typeof rotationRaw === 'string' ? Number(rotationRaw) : 0;
  const rotationApplied =
    rotationParsed === 90 || rotationParsed === 180 || rotationParsed === 270
      ? rotationParsed
      : 0;

  // Optional crop fields — all four required, all four must parse to finite
  // numbers in [0, 1], with cropX + cropW <= 1 and cropY + cropH <= 1, and
  // neither cropW nor cropH may be zero. Any failure → un-cropped audit.
  // Wire-additive, defensive parse — same posture as rotation.
  const cropParsed = parseCropFields(form);
  const cropApplied = cropParsed !== null;
  const cropRect = cropParsed;

  // Optional `lastOdometerMi` / `lastPricePerUnit` form fields — each
  // meaningful only to its own mode (odometer / pump respectively).
  // Plumbed end-to-end into the prompt as soft sanity-check hints (see
  // `buildOdometerPrompt` / `buildPumpPrompt` in ocrModes.ts). Defensive
  // parse: any value that isn't a finite positive number is silently
  // dropped, so an adversarial / malformed wire field can't poison the
  // prompt or the audit log. Wire-additive — old clients omit the field
  // entirely.
  const lastOdometerMi = parseLastOdometerMi(form);
  const lastPricePerUnit = parseLastPricePerUnit(form);

  const file = form.get('image');
  if (!(file instanceof File)) return json({ error: 'image required' }, { status: 400 });
  if (file.size === 0) return json({ error: 'empty image' }, { status: 400 });
  if (file.size > env.ocrMaxImageBytes) {
    return json({ error: `image must be <= ${env.ocrMaxImageBytes} bytes` }, { status: 413 });
  }

  const arr = new Uint8Array(await file.arrayBuffer());
  const outcome = await runOcrPipeline({
    bytes: arr, mode, provider, env,
    lastOdometerMi, lastPricePerUnit,
    logger: locals.logger
  });

  const ipHash = hashIp(ip, hmacKey!);
  const imgHash = hashImage(arr);

  if (outcome.ok) {
    await budget!.add(outcome.costCents);
    await audit!.append({
      mode,
      rotationApplied,
      cropApplied,
      cropRect,
      ...(lastOdometerMi !== undefined ? { lastOdometerMi } : {}),
      ...(lastPricePerUnit !== undefined ? { lastPricePerUnit } : {}),
      ipHash, imgHash, imgBytes: arr.byteLength,
      imageType: outcome.imageType,
      provider: outcome.provider,
      model: modelForSlot(outcome.provider, env),
      fellbackFrom: outcome.fellbackFrom,
      latencyMs: outcome.latencyMs, costCents: outcome.costCents,
      parsed: outcome.result, ok: true
    });
    return json(outcome.result);
  }

  // Failure path — record the audit row but `provider` reflects the
  // chain's entry slot (not the active provider, since none succeeded).
  // For a bare provider, that's just `provider.name`. For a chain, that's
  // the first slot in the chain — which is `chain.chain[0].name`.
  const failSlot: OcrSlotName =
    provider instanceof ChainOcrProvider ? provider.chain[0].name : provider.name;
  await audit!.append({
    mode,
    rotationApplied,
    cropApplied,
    cropRect,
    ...(lastOdometerMi !== undefined ? { lastOdometerMi } : {}),
    ...(lastPricePerUnit !== undefined ? { lastPricePerUnit } : {}),
    ipHash, imgHash, imgBytes: arr.byteLength,
    imageType: outcome.imageType ?? 'unknown',
    provider: failSlot,
    model: modelForSlot(failSlot, env),
    fellbackFrom: null,
    latencyMs: outcome.latencyMs, costCents: 0,
    parsed: null, ok: false,
    error: { code: String(outcome.statusCode), message: outcome.error }
  });
  return json({ error: outcome.error }, { status: outcome.statusCode });
};

// Best-effort early rejection from the advertised Content-Length. Returns true
// only when the header is present, numeric, positive, and exceeds the image
// policy plus a generous envelope allowance. A missing / non-numeric / lying
// header returns false so the request falls through to the authoritative
// post-parse `file.size` check. Underscore-prefixed so SvelteKit's endpoint
// export validation permits it (test-only export, same as `_resetForTests`).
export function _contentLengthExceeds(header: string | null, maxImageBytes: number): boolean {
  if (header === null) return false;
  const n = Number(header);
  if (!Number.isFinite(n) || n <= 0) return false;
  return n > maxImageBytes + MULTIPART_OVERHEAD_BYTES;
}

function parseCropFields(form: FormData): { x: number; y: number; w: number; h: number } | null {
  const x = form.get('cropX');
  const y = form.get('cropY');
  const w = form.get('cropW');
  const h = form.get('cropH');
  // All four or nothing.
  if (typeof x !== 'string' || typeof y !== 'string' || typeof w !== 'string' || typeof h !== 'string') {
    return null;
  }
  const xn = Number(x);
  const yn = Number(y);
  const wn = Number(w);
  const hn = Number(h);
  if (!Number.isFinite(xn) || !Number.isFinite(yn) || !Number.isFinite(wn) || !Number.isFinite(hn)) {
    return null;
  }
  if (xn < 0 || yn < 0 || wn <= 0 || hn <= 0) return null;
  if (xn + wn > 1 || yn + hn > 1) return null;
  return { x: xn, y: yn, w: wn, h: hn };
}

// Defensive parse of the optional `lastOdometerMi` multipart field. Returns
// the numeric value only when it parses to a finite positive number;
// anything else (missing, empty, non-numeric, NaN, infinite, zero,
// negative) collapses to `undefined` so the prompt builder skips the hint
// and the audit row omits the field.
function parseLastOdometerMi(form: FormData): number | undefined {
  const raw = form.get('lastOdometerMi');
  if (typeof raw !== 'string' || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

// Defensive parse of the optional `lastPricePerUnit` multipart field —
// same shape as `parseLastOdometerMi`. Pump-mode-meaningful soft hint
// (e.g., 3.679 for a $3.679/gal prior fillup). Currency-agnostic on
// purpose; the prompt embeds the magnitude alone.
function parseLastPricePerUnit(form: FormData): number | undefined {
  const raw = form.get('lastPricePerUnit');
  if (typeof raw !== 'string' || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}
