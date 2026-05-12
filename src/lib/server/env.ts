export type FxProviderName = 'frankfurter' | 'erapi' | 'fawazahmed';

const KNOWN_FX_PROVIDERS: ReadonlySet<FxProviderName> = new Set([
  'frankfurter', 'erapi', 'fawazahmed'
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

  // --- OCR (optional; feature is enabled iff ollamaVisionUrl or openrouterApiKey is set) ---
  ollamaVisionUrl: string | undefined;
  ollamaVisionModel: string;
  ollamaVisionTimeoutMs: number;
  ollamaKeepAlive: string;
  openrouterApiKey: string | undefined;
  openrouterVisionModel: string;
  openrouterVisionTimeoutMs: number;

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
    ollamaVisionModel: process.env.OLLAMA_VISION_MODEL || 'qwen2.5vl:3b',
    ollamaVisionTimeoutMs: Number(process.env.OLLAMA_VISION_TIMEOUT_MS ?? 60_000),
    ollamaKeepAlive: process.env.OLLAMA_KEEP_ALIVE || '30m',
    openrouterApiKey: process.env.OPENROUTER_API_KEY || undefined,
    openrouterVisionModel: process.env.OPENROUTER_VISION_MODEL || 'google/gemini-2.5-flash-lite',
    openrouterVisionTimeoutMs: Number(process.env.OPENROUTER_VISION_TIMEOUT_MS ?? 30_000),

    ocrDailyBudgetUsd: Number(process.env.OCR_DAILY_BUDGET_USD ?? 1.0),
    ocrRateLimitPerHour: Number(process.env.OCR_RATE_LIMIT_PER_HOUR ?? 20),

    ocrBudgetPath: process.env.OCR_BUDGET_PATH || '/data/ocr-budget.json',
    ocrAuditPath: process.env.OCR_AUDIT_PATH || '/data/ocr-audit.jsonl',
    ocrAuditKeyPath: process.env.OCR_AUDIT_KEY_PATH || '/data/ocr-audit-key.txt',
    ocrAuditHmacKey: process.env.OCR_AUDIT_HMAC_KEY || undefined,

    ocrPumpVolumeMax: Number(process.env.OCR_PUMP_VOLUME_MAX ?? 200),
    ocrPumpCostMax: Number(process.env.OCR_PUMP_COST_MAX ?? 500),
    ocrPumpPricePerUnitMax: Number(process.env.OCR_PUMP_PRICE_PER_UNIT_MAX ?? 20),
    ocrOdometerMaxMi: Number(process.env.OCR_ODOMETER_MAX_MI ?? 1_000_000)
  };
}
