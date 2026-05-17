import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadEnv, EnvError } from './env';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (
      k.startsWith('LUBELOGGER_') ||
      k.startsWith('FX_') ||
      k.startsWith('OLLAMA_') ||
      k.startsWith('OPENROUTER_') ||
      k.startsWith('OCR_') ||
      k.startsWith('OPENAI_COMPATIBLE_')
    ) {
      delete process.env[k];
    }
  }
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('loadEnv', () => {
  it('throws EnvError when LUBELOGGER_URL is missing', () => {
    process.env.LUBELOGGER_API_KEY = 'k';
    expect(() => loadEnv()).toThrow(EnvError);
    expect(() => loadEnv()).toThrow(/LUBELOGGER_URL/);
  });

  it('throws EnvError when LUBELOGGER_API_KEY is missing', () => {
    process.env.LUBELOGGER_URL = 'http://lubelog:8080';
    expect(() => loadEnv()).toThrow(/LUBELOGGER_API_KEY/);
  });

  it('returns sane defaults for optional vars', () => {
    process.env.LUBELOGGER_URL = 'http://lubelog:8080';
    process.env.LUBELOGGER_API_KEY = 'abc';
    const env = loadEnv();
    expect(env.lubeloggerVolumeUnit).toBe('gallons_us');
    expect(env.lubeloggerCurrency).toBe('USD');
    expect(env.fxProviders).toEqual(['frankfurter', 'erapi', 'fawazahmed']);
    expect(env.fxCachePath).toBe('/data/fx-cache.json');
  });

  it('parses FX_PROVIDERS as CSV', () => {
    process.env.LUBELOGGER_URL = 'http://lubelog:8080';
    process.env.LUBELOGGER_API_KEY = 'abc';
    process.env.FX_PROVIDERS = 'erapi, frankfurter ,fawazahmed';
    const env = loadEnv();
    expect(env.fxProviders).toEqual(['erapi', 'frankfurter', 'fawazahmed']);
  });

  it('rejects unknown FX provider names', () => {
    process.env.LUBELOGGER_URL = 'http://lubelog:8080';
    process.env.LUBELOGGER_API_KEY = 'abc';
    process.env.FX_PROVIDERS = 'frankfurter,bogus';
    expect(() => loadEnv()).toThrow(/unknown FX provider/i);
  });
});

describe('loadEnv — OCR fields', () => {
  beforeEach(() => {
    process.env.LUBELOGGER_URL = 'http://lubelog:8080';
    process.env.LUBELOGGER_API_KEY = 'k';
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('OLLAMA_') || k.startsWith('OPENROUTER_') ||
          k.startsWith('OCR_') || k.startsWith('OPENAI_COMPATIBLE_')) {
        delete process.env[k];
      }
    }
  });

  it('OCR fields default to undefined / sensible defaults when nothing is set', () => {
    const env = loadEnv();
    expect(env.ollamaVisionUrl).toBeUndefined();
    expect(env.ollamaVisionModel).toBe('qwen2.5vl:7b');
    expect(env.ollamaVisionTimeoutMs).toBe(60_000);
    expect(env.ollamaKeepAlive).toBe('30m');
    expect(env.openrouterApiKey).toBeUndefined();
    expect(env.openrouterVisionModel).toBe('google/gemini-2.5-flash-lite');
    expect(env.openrouterVisionTimeoutMs).toBe(30_000);
    expect(env.ocrDailyBudgetUsd).toBe(1.0);
    expect(env.ocrRateLimitPerHour).toBe(20);
    expect(env.ocrBudgetPath).toBe('/data/ocr-budget.json');
    expect(env.ocrAuditPath).toBe('/data/ocr-audit.jsonl');
    expect(env.ocrAuditKeyPath).toBe('/data/ocr-audit-key.txt');
    expect(env.ocrAuditHmacKey).toBeUndefined();
    expect(env.ocrPumpVolumeMax).toBe(200);
    expect(env.ocrPumpCostMax).toBe(500);
    expect(env.ocrPumpPricePerUnitMax).toBe(20);
    expect(env.ocrOdometerMaxMi).toBe(1_000_000);
  });

  it('reads OLLAMA_*, OPENROUTER_*, and OCR_* when set', () => {
    process.env.OLLAMA_VISION_URL = 'http://ollama:11434';
    process.env.OLLAMA_VISION_MODEL = 'qwen2.5vl:7b';
    process.env.OLLAMA_VISION_TIMEOUT_MS = '90000';
    process.env.OLLAMA_KEEP_ALIVE = '1h';
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.OPENROUTER_VISION_MODEL = 'anthropic/claude-3-haiku';
    process.env.OPENROUTER_VISION_TIMEOUT_MS = '15000';
    process.env.OCR_DAILY_BUDGET_USD = '5.50';
    process.env.OCR_RATE_LIMIT_PER_HOUR = '5';
    process.env.OCR_BUDGET_PATH = '/tmp/b.json';
    process.env.OCR_AUDIT_PATH = '/tmp/a.jsonl';
    process.env.OCR_AUDIT_KEY_PATH = '/tmp/k.txt';
    process.env.OCR_AUDIT_HMAC_KEY = 'override-key';
    process.env.OCR_PUMP_VOLUME_MAX = '300';
    process.env.OCR_PUMP_COST_MAX = '750';
    process.env.OCR_PUMP_PRICE_PER_UNIT_MAX = '25';
    process.env.OCR_ODOMETER_MAX_MI = '2000000';
    const env = loadEnv();
    expect(env.ollamaVisionUrl).toBe('http://ollama:11434');
    expect(env.ollamaVisionModel).toBe('qwen2.5vl:7b');
    expect(env.ollamaVisionTimeoutMs).toBe(90_000);
    expect(env.ollamaKeepAlive).toBe('1h');
    expect(env.openrouterApiKey).toBe('sk-or-test');
    expect(env.openrouterVisionModel).toBe('anthropic/claude-3-haiku');
    expect(env.openrouterVisionTimeoutMs).toBe(15_000);
    expect(env.ocrDailyBudgetUsd).toBe(5.5);
    expect(env.ocrRateLimitPerHour).toBe(5);
    expect(env.ocrBudgetPath).toBe('/tmp/b.json');
    expect(env.ocrAuditPath).toBe('/tmp/a.jsonl');
    expect(env.ocrAuditKeyPath).toBe('/tmp/k.txt');
    expect(env.ocrAuditHmacKey).toBe('override-key');
    expect(env.ocrPumpVolumeMax).toBe(300);
    expect(env.ocrPumpCostMax).toBe(750);
    expect(env.ocrPumpPricePerUnitMax).toBe(25);
    expect(env.ocrOdometerMaxMi).toBe(2_000_000);
  });

  it('empty-string numeric env vars fall back to defaults', () => {
    process.env.OCR_DAILY_BUDGET_USD = '';
    process.env.OCR_RATE_LIMIT_PER_HOUR = '';
    const env = loadEnv();
    expect(env.ocrDailyBudgetUsd).toBe(1.0);
    expect(env.ocrRateLimitPerHour).toBe(20);
  });

  it('throws EnvError when a numeric env var is non-finite', () => {
    process.env.OCR_DAILY_BUDGET_USD = 'abc';
    expect(() => loadEnv()).toThrow(EnvError);
    expect(() => loadEnv()).toThrow(/OCR_DAILY_BUDGET_USD/);
  });
});

describe('loadEnv — OCR_PROVIDER_CHAIN parsing', () => {
  beforeEach(() => {
    process.env.LUBELOGGER_URL = 'http://lubelog:8080';
    process.env.LUBELOGGER_API_KEY = 'k';
    delete process.env.OCR_PROVIDER_CHAIN;
  });

  it('ocrProviderChain is undefined when OCR_PROVIDER_CHAIN is unset', () => {
    const env = loadEnv();
    expect(env.ocrProviderChain).toBeUndefined();
  });

  it('ocrProviderChain is undefined when OCR_PROVIDER_CHAIN is empty / whitespace', () => {
    process.env.OCR_PROVIDER_CHAIN = '   ';
    const env = loadEnv();
    expect(env.ocrProviderChain).toBeUndefined();
  });

  it('parses a clean CSV of known slot identifiers', () => {
    process.env.OCR_PROVIDER_CHAIN = 'ollama-cloud,ollama-local,openrouter,openai-compatible';
    const env = loadEnv();
    expect(env.ocrProviderChain).toEqual([
      'ollama-cloud', 'ollama-local', 'openrouter', 'openai-compatible'
    ]);
  });

  it('tolerates whitespace and empty entries inside the CSV', () => {
    process.env.OCR_PROVIDER_CHAIN = ' ollama-cloud , , openrouter ';
    const env = loadEnv();
    expect(env.ocrProviderChain).toEqual(['ollama-cloud', 'openrouter']);
  });

  it('throws EnvError on an unknown slot identifier', () => {
    process.env.OCR_PROVIDER_CHAIN = 'ollama-cloud,bogus';
    expect(() => loadEnv()).toThrow(EnvError);
    expect(() => loadEnv()).toThrow(/OCR_PROVIDER_CHAIN/);
    expect(() => loadEnv()).toThrow(/bogus/);
  });

  it('throws EnvError on a duplicate slot identifier', () => {
    process.env.OCR_PROVIDER_CHAIN = 'ollama-local,openrouter,ollama-local';
    expect(() => loadEnv()).toThrow(EnvError);
    expect(() => loadEnv()).toThrow(/Duplicate/);
  });
});

describe('loadEnv — new OCR slot defaults', () => {
  beforeEach(() => {
    process.env.LUBELOGGER_URL = 'http://lubelog:8080';
    process.env.LUBELOGGER_API_KEY = 'k';
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('OLLAMA_') || k.startsWith('OPENROUTER_') ||
          k.startsWith('OCR_') || k.startsWith('OPENAI_COMPATIBLE_')) {
        delete process.env[k];
      }
    }
  });

  it('OLLAMA_CLOUD_URL defaults to https://ollama.com', () => {
    const env = loadEnv();
    expect(env.ollamaCloudUrl).toBe('https://ollama.com');
  });

  it('OLLAMA_CLOUD_MODEL defaults to gemma4:31b', () => {
    const env = loadEnv();
    expect(env.ollamaCloudModel).toBe('gemma4:31b');
  });

  it('OLLAMA_CLOUD_TIMEOUT_MS defaults to 30000', () => {
    const env = loadEnv();
    expect(env.ollamaCloudTimeoutMs).toBe(30_000);
  });

  it('OPENAI_COMPATIBLE_TIMEOUT_MS defaults to 30000', () => {
    const env = loadEnv();
    expect(env.openaiCompatibleTimeoutMs).toBe(30_000);
  });

  it('reads OLLAMA_CLOUD_* and OPENAI_COMPATIBLE_* when set', () => {
    process.env.OLLAMA_CLOUD_API_KEY = 'sk-cloud';
    process.env.OLLAMA_CLOUD_URL = 'https://ollama.example';
    process.env.OLLAMA_CLOUD_MODEL = 'qwen3-vl:235b-instruct';
    process.env.OLLAMA_CLOUD_TIMEOUT_MS = '15000';
    process.env.OPENAI_COMPATIBLE_URL = 'https://api.groq.com/openai/v1/chat/completions';
    process.env.OPENAI_COMPATIBLE_API_KEY = 'gsk-1';
    process.env.OPENAI_COMPATIBLE_MODEL = 'llama-3.2-90b-vision-preview';
    process.env.OPENAI_COMPATIBLE_TIMEOUT_MS = '20000';
    const env = loadEnv();
    expect(env.ollamaCloudApiKey).toBe('sk-cloud');
    expect(env.ollamaCloudUrl).toBe('https://ollama.example');
    expect(env.ollamaCloudModel).toBe('qwen3-vl:235b-instruct');
    expect(env.ollamaCloudTimeoutMs).toBe(15_000);
    expect(env.openaiCompatibleUrl).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(env.openaiCompatibleApiKey).toBe('gsk-1');
    expect(env.openaiCompatibleModel).toBe('llama-3.2-90b-vision-preview');
    expect(env.openaiCompatibleTimeoutMs).toBe(20_000);
  });
});
