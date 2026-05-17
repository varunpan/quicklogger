export type FxProviderName = 'frankfurter' | 'erapi' | 'fawazahmed';
export type OcrSlotName = 'ollama-local' | 'ollama-cloud' | 'openrouter' | 'openai-compatible';

const KNOWN_FX_PROVIDERS: ReadonlySet<FxProviderName> = new Set([
  'frankfurter', 'erapi', 'fawazahmed'
]);

const KNOWN_OCR_SLOTS: ReadonlySet<OcrSlotName> = new Set([
  'ollama-local', 'ollama-cloud', 'openrouter', 'openai-compatible'
]);

export interface Env {
  lubeloggerUrl: string;
  lubeloggerApiKey: string;
  lubeloggerVolumeUnit: string;
  lubeloggerCurrency: string;
  fxProviders: FxProviderName[];
  fxCachePath: string;
  port: number;
  origin: string | undefined;

  // --- OCR (optional; feature is enabled iff any provider slot is configured) ---
  ollamaVisionUrl: string | undefined;
  ollamaVisionModel: string;
  ollamaVisionTimeoutMs: number;
  ollamaKeepAlive: string;
  openrouterApiKey: string | undefined;
  openrouterVisionModel: string;
  openrouterVisionTimeoutMs: number;

  // --- New slots (v0.2.2+) ---
  ollamaCloudApiKey: string | undefined;
  ollamaCloudUrl: string;
  ollamaCloudModel: string;
  ollamaCloudTimeoutMs: number;

  openaiCompatibleUrl: string | undefined;
  openaiCompatibleApiKey: string | undefined;
  openaiCompatibleModel: string | undefined;
  openaiCompatibleTimeoutMs: number;

  ocrProviderChain: OcrSlotName[] | undefined;

  ocrDailyBudgetUsd: number;
  ocrRateLimitPerHour: number;

  ocrBudgetPath: string;
  ocrAuditPath: string;
  ocrAuditKeyPath: string;
  ocrAuditHmacKey: string | undefined;

  ocrPumpVolumeMax: number;
  ocrPumpCostMax: number;
  ocrPumpPricePerUnitMax: number;
  ocrOdometerMaxMi: number;
}

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new EnvError(`Required env var ${name} is not set`);
  return v;
}

function numberOr(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new EnvError(`${name} must be a finite number, got "${v}"`);
  return n;
}

function parseOcrProviderChain(): OcrSlotName[] | undefined {
  const raw = process.env.OCR_PROVIDER_CHAIN;
  if (raw === undefined || raw.trim() === '') return undefined;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  for (const p of parts) {
    if (!KNOWN_OCR_SLOTS.has(p as OcrSlotName)) {
      throw new EnvError(`Unknown OCR slot in OCR_PROVIDER_CHAIN: ${p}`);
    }
    if (seen.has(p)) {
      throw new EnvError(`Duplicate OCR slot in OCR_PROVIDER_CHAIN: ${p}`);
    }
    seen.add(p);
  }
  return parts as OcrSlotName[];
}

export function loadEnv(): Env {
  const fxRaw = (process.env.FX_PROVIDERS ?? 'frankfurter,erapi,fawazahmed')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of fxRaw) {
    if (!KNOWN_FX_PROVIDERS.has(p as FxProviderName)) {
      throw new EnvError(`Unknown FX provider: ${p}`);
    }
  }
  return {
    lubeloggerUrl: required('LUBELOGGER_URL'),
    lubeloggerApiKey: required('LUBELOGGER_API_KEY'),
    lubeloggerVolumeUnit: process.env.LUBELOGGER_VOLUME_UNIT ?? 'gallons_us',
    lubeloggerCurrency: process.env.LUBELOGGER_CURRENCY ?? 'USD',
    fxProviders: fxRaw as FxProviderName[],
    fxCachePath: process.env.FX_CACHE_PATH ?? '/data/fx-cache.json',
    port: Number(process.env.PORT ?? 3000),
    origin: process.env.ORIGIN,

    ollamaVisionUrl: process.env.OLLAMA_VISION_URL || undefined,
    ollamaVisionModel: process.env.OLLAMA_VISION_MODEL || 'qwen2.5vl:7b',
    ollamaVisionTimeoutMs: numberOr('OLLAMA_VISION_TIMEOUT_MS', 60_000),
    ollamaKeepAlive: process.env.OLLAMA_KEEP_ALIVE || '30m',
    openrouterApiKey: process.env.OPENROUTER_API_KEY || undefined,
    openrouterVisionModel: process.env.OPENROUTER_VISION_MODEL || 'google/gemini-2.5-flash-lite',
    openrouterVisionTimeoutMs: numberOr('OPENROUTER_VISION_TIMEOUT_MS', 30_000),

    ollamaCloudApiKey: process.env.OLLAMA_CLOUD_API_KEY || undefined,
    ollamaCloudUrl: process.env.OLLAMA_CLOUD_URL || 'https://ollama.com',
    ollamaCloudModel: process.env.OLLAMA_CLOUD_MODEL || 'gemma4:31b',
    ollamaCloudTimeoutMs: numberOr('OLLAMA_CLOUD_TIMEOUT_MS', 30_000),

    openaiCompatibleUrl: process.env.OPENAI_COMPATIBLE_URL || undefined,
    openaiCompatibleApiKey: process.env.OPENAI_COMPATIBLE_API_KEY || undefined,
    openaiCompatibleModel: process.env.OPENAI_COMPATIBLE_MODEL || undefined,
    openaiCompatibleTimeoutMs: numberOr('OPENAI_COMPATIBLE_TIMEOUT_MS', 30_000),

    ocrProviderChain: parseOcrProviderChain(),

    ocrDailyBudgetUsd: numberOr('OCR_DAILY_BUDGET_USD', 1.0),
    ocrRateLimitPerHour: numberOr('OCR_RATE_LIMIT_PER_HOUR', 20),

    ocrBudgetPath: process.env.OCR_BUDGET_PATH || '/data/ocr-budget.json',
    ocrAuditPath: process.env.OCR_AUDIT_PATH || '/data/ocr-audit.jsonl',
    ocrAuditKeyPath: process.env.OCR_AUDIT_KEY_PATH || '/data/ocr-audit-key.txt',
    ocrAuditHmacKey: process.env.OCR_AUDIT_HMAC_KEY || undefined,

    ocrPumpVolumeMax: numberOr('OCR_PUMP_VOLUME_MAX', 200),
    ocrPumpCostMax: numberOr('OCR_PUMP_COST_MAX', 500),
    ocrPumpPricePerUnitMax: numberOr('OCR_PUMP_PRICE_PER_UNIT_MAX', 20),
    ocrOdometerMaxMi: numberOr('OCR_ODOMETER_MAX_MI', 1_000_000)
  };
}
