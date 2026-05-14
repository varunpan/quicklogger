import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadEnv, type Env } from '$lib/server/env';
import { selectProvider, runOcrPipeline } from '$lib/server/ocr';
import { OcrRateLimiter } from '$lib/server/ocrRateLimit';
import { OcrBudget, JsonFileBudgetStore } from '$lib/server/ocrBudget';
import { OcrAudit, hashIp, hashImage, resolveAuditHmacKey } from '$lib/server/ocrAudit';
import type { OcrMode, OcrStatus } from '$lib/shared/types';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;        // 5 MiB post-multipart
const AUDIT_MAX_BYTES = 10 * 1024 * 1024;       // 10 MiB JSONL rotation

let rateLimiter: OcrRateLimiter | null = null;
let budget: OcrBudget | null = null;
let audit: OcrAudit | null = null;
let hmacKey: Buffer | null = null;

function bootstrap(env: Env) {
  if (rateLimiter && budget && audit && hmacKey) return;
  rateLimiter = new OcrRateLimiter({ perHour: env.ocrRateLimitPerHour });
  budget = new OcrBudget({
    dailyUsd: env.ocrDailyBudgetUsd,
    store: new JsonFileBudgetStore(env.ocrBudgetPath)
  });
  audit = new OcrAudit({ path: env.ocrAuditPath, maxBytes: AUDIT_MAX_BYTES });
  hmacKey = resolveAuditHmacKey({
    ocrAuditHmacKey: env.ocrAuditHmacKey,
    ocrAuditKeyPath: env.ocrAuditKeyPath
  });
}

export function _resetForTests() {
  rateLimiter = null; budget = null; audit = null; hmacKey = null;
}

// v0.2.0 advertises pump + odometer. 'receipt' is wire-accepted (returns 501)
// but NOT listed here — listing it would imply usability.
const ADVERTISED_MODES: OcrMode[] = ['pump', 'odometer'];
// Wire-accepted modes the parser recognizes (drives 400 vs 501 vs valid).
const ACCEPTED_WIRE_MODES = new Set<string>(['pump', 'odometer', 'receipt']);
const RESERVED_MODES = new Set<string>(['receipt']);

export const GET: RequestHandler = async () => {
  const env = loadEnv();
  const enabled = !!env.ollamaVisionUrl || !!env.openrouterApiKey;
  const body: OcrStatus = enabled
    ? { enabled: true, modes: ADVERTISED_MODES }
    : { enabled: false };
  return json(body);
};

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const env = loadEnv();
  bootstrap(env);
  const provider = selectProvider(env);
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'multipart parse failed' }, { status: 400 });
  }

  const modeRaw = form.get('mode');
  if (typeof modeRaw !== 'string') {
    return json({ error: 'mode is required' }, { status: 400 });
  }
  if (!ACCEPTED_WIRE_MODES.has(modeRaw)) {
    return json({ error: `unknown mode: ${modeRaw}` }, { status: 400 });
  }
  if (RESERVED_MODES.has(modeRaw)) {
    return json({ error: `${modeRaw} OCR not yet supported in this version` }, { status: 501 });
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

  const file = form.get('image');
  if (!(file instanceof File)) return json({ error: 'image required' }, { status: 400 });
  if (file.size === 0) return json({ error: 'empty image' }, { status: 400 });
  if (file.size > MAX_IMAGE_BYTES) {
    return json({ error: `image must be <= ${MAX_IMAGE_BYTES} bytes` }, { status: 413 });
  }

  const arr = new Uint8Array(await file.arrayBuffer());
  const outcome = await runOcrPipeline({ bytes: arr, mode, provider, env });

  const ipHash = hashIp(ip, hmacKey!);
  const imgHash = hashImage(arr);
  const modelName = provider.name === 'ollama' ? env.ollamaVisionModel : env.openrouterVisionModel;

  if (outcome.ok) {
    await budget!.add(outcome.costCents);
    await audit!.append({
      mode,
      rotationApplied,
      ipHash, imgHash, imgBytes: arr.byteLength,
      imageType: outcome.imageType,
      provider: outcome.provider,
      model: outcome.provider === 'ollama' ? env.ollamaVisionModel : env.openrouterVisionModel,
      fellbackTo: outcome.fellbackTo,
      latencyMs: outcome.latencyMs, costCents: outcome.costCents,
      parsed: outcome.result, ok: true
    });
    return json(outcome.result);
  }

  await audit!.append({
    mode,
    rotationApplied,
    ipHash, imgHash, imgBytes: arr.byteLength,
    imageType: outcome.imageType ?? 'jpeg',
    provider: provider.name === 'openrouter' ? 'openrouter' : 'ollama',
    model: modelName,
    fellbackTo: null,
    latencyMs: outcome.latencyMs, costCents: 0,
    parsed: null, ok: false,
    error: { code: String(outcome.statusCode), message: outcome.error }
  });
  return json({ error: outcome.error }, { status: outcome.statusCode });
};
