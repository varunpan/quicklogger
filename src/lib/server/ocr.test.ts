import { describe, it, expect, beforeEach } from 'vitest';
import {
  sniffImageType, selectProvider, runOcrPipeline,
  _resetChainMemoForTests, type PipelineOutcome
} from './ocr';
import { ChainOcrProvider, type OcrProvider } from './ocrProviders';
import type { Env } from './env';
import type { Logger } from './logger';

const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP_HEAD = Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')
]);
const HEIC_HEAD = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic')
]);
const NOT_AN_IMAGE = Buffer.from('this is plain text bytes...');

describe('sniffImageType', () => {
  it('detects JPEG by magic bytes', () => expect(sniffImageType(JPEG_HEAD)).toBe('jpeg'));
  it('detects PNG by magic bytes', () => expect(sniffImageType(PNG_HEAD)).toBe('png'));
  it('detects WebP by RIFF/WEBP', () => expect(sniffImageType(WEBP_HEAD)).toBe('webp'));
  it('detects HEIC by ftyp box', () => expect(sniffImageType(HEIC_HEAD)).toBe('heic'));
  it('returns null for non-image bytes', () => expect(sniffImageType(NOT_AN_IMAGE)).toBeNull());
  it('returns null for too-short buffers', () => expect(sniffImageType(Buffer.from([0xff]))).toBeNull());
});

function envOverrides(o: Partial<Env>): Env {
  return {
    lubeloggerUrl: 'http://lubelog', lubeloggerApiKey: 'k',
    lubeloggerVolumeUnit: 'gallons_us', lubeloggerCurrency: 'USD',
    fxProviders: ['frankfurter'],
    fxCachePath: '/tmp/fx', port: 3000, origin: undefined,
    ollamaVisionUrl: undefined, ollamaVisionModel: 'qwen2.5vl:7b',
    ollamaVisionTimeoutMs: 60_000, ollamaKeepAlive: '30m',
    openrouterApiKey: undefined, openrouterVisionModel: 'google/gemini-2.5-flash-lite',
    openrouterVisionTimeoutMs: 30_000,
    ollamaCloudApiKey: undefined,
    ollamaCloudUrl: 'https://ollama.com',
    ollamaCloudModel: 'gemma4:31b',
    ollamaCloudTimeoutMs: 30_000,
    openaiCompatibleUrl: undefined,
    openaiCompatibleApiKey: undefined,
    openaiCompatibleModel: undefined,
    openaiCompatibleTimeoutMs: 30_000,
    ocrProviderChain: undefined,
    ocrDailyBudgetUsd: 1, ocrRateLimitPerHour: 20,
    ocrBudgetPath: '/tmp/b.json', ocrAuditPath: '/tmp/a.jsonl',
    ocrAuditKeyPath: '/tmp/k.txt', ocrAuditHmacKey: undefined,
    ocrPumpVolumeMax: 200, ocrPumpCostMax: 500, ocrPumpPricePerUnitMax: 20,
    ocrOdometerMaxMi: 1_000_000,
    logLevel: 'info', logPretty: false, logFilePath: undefined,
    logFileMaxSizeMb: 5, logFileMaxFiles: 5, envWarnings: [],
    ...o
  };
}

describe('selectProvider', () => {
  beforeEach(() => _resetChainMemoForTests());

  it('returns null + 0 chainTimeoutMs when no slots are configured', () => {
    const r = selectProvider(envOverrides({}));
    expect(r.provider).toBeNull();
    expect(r.chainTimeoutMs).toBe(0);
  });

  it('returns a bare provider (no chain wrapper) when one slot is configured', () => {
    const r = selectProvider(envOverrides({ ollamaVisionUrl: 'http://o' }));
    expect(r.provider?.name).toBe('ollama-local');
    expect(r.provider).not.toBeInstanceOf(ChainOcrProvider);
    expect(r.chainTimeoutMs).toBe(60_000);
  });

  it('returns the OpenRouter slot bare when only OPENROUTER_API_KEY is set', () => {
    const r = selectProvider(envOverrides({ openrouterApiKey: 'sk' }));
    expect(r.provider?.name).toBe('openrouter');
    expect(r.provider).not.toBeInstanceOf(ChainOcrProvider);
    expect(r.chainTimeoutMs).toBe(30_000);
  });

  it('defaults to back-compat order [ollama-local, openrouter, ollama-cloud, openai-compatible] when OCR_PROVIDER_CHAIN is unset', () => {
    const r = selectProvider(envOverrides({
      ollamaVisionUrl: 'http://o',
      openrouterApiKey: 'sk',
      ollamaCloudApiKey: 'sk-c'
    }));
    expect(r.provider).toBeInstanceOf(ChainOcrProvider);
    if (r.provider instanceof ChainOcrProvider) {
      expect(r.provider.chain.map((p) => p.name)).toEqual([
        'ollama-local', 'openrouter', 'ollama-cloud'
      ]);
    }
    expect(r.chainTimeoutMs).toBe(60_000 + 30_000 + 30_000);
  });

  it('respects explicit OCR_PROVIDER_CHAIN order', () => {
    const r = selectProvider(envOverrides({
      ollamaVisionUrl: 'http://o',
      openrouterApiKey: 'sk',
      ollamaCloudApiKey: 'sk-c',
      ocrProviderChain: ['ollama-cloud', 'ollama-local', 'openrouter']
    }));
    expect(r.provider).toBeInstanceOf(ChainOcrProvider);
    if (r.provider instanceof ChainOcrProvider) {
      expect(r.provider.chain.map((p) => p.name)).toEqual([
        'ollama-cloud', 'ollama-local', 'openrouter'
      ]);
    }
  });

  it('WARNs and drops an explicitly-named slot whose required vars are missing', () => {
    const warnings: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];
    const logger = {
      warn: (msg: string, ctx?: Record<string, unknown>) => warnings.push({ msg, ctx }),
      info: () => {}
    };
    const r = selectProvider(envOverrides({
      ollamaVisionUrl: 'http://o',
      ocrProviderChain: ['ollama-local', 'openai-compatible']
    }), logger);
    expect(r.provider?.name).toBe('ollama-local');
    const skip = warnings.find((w) => w.msg === 'ocr chain slot skipped');
    expect(skip).toBeDefined();
    expect(skip?.ctx?.slot).toBe('openai-compatible');
    expect(skip?.ctx?.missing_env).toBe('OPENAI_COMPATIBLE_API_KEY (and URL, MODEL)');
  });

  it('silent-skips a missing-config slot when the default chain is in effect (no WARN)', () => {
    const warnings: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];
    const logger = {
      warn: (msg: string, ctx?: Record<string, unknown>) => warnings.push({ msg, ctx }),
      info: () => {}
    };
    const r = selectProvider(envOverrides({
      ollamaVisionUrl: 'http://o'
      // no openrouter, no cloud, no oai-compat — but no explicit chain either
    }), logger);
    expect(r.provider?.name).toBe('ollama-local');
    expect(warnings).toHaveLength(0);
  });

  it('logs the effective chain at INFO when more than one slot survives', () => {
    const infos: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];
    const logger = {
      warn: () => {},
      info: (msg: string, ctx?: Record<string, unknown>) => infos.push({ msg, ctx })
    };
    selectProvider(envOverrides({
      ollamaVisionUrl: 'http://o',
      openrouterApiKey: 'sk'
    }), logger);
    const chain = infos.find((m) => m.msg === 'ocr chain effective');
    expect(chain).toBeDefined();
    expect(chain?.ctx?.providers).toEqual(['ollama-local', 'openrouter']);
  });

  it('does not emit the INFO chain log when only one slot survives', () => {
    const infos: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];
    const logger = {
      warn: () => {},
      info: (msg: string, ctx?: Record<string, unknown>) => infos.push({ msg, ctx })
    };
    selectProvider(envOverrides({ ollamaVisionUrl: 'http://o' }), logger);
    expect(infos).toHaveLength(0);
  });

  it('memoizes the chain so repeated calls with the same composition emit only once', () => {
    const infos: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];
    const logger = {
      warn: () => {},
      info: (msg: string, ctx?: Record<string, unknown>) => infos.push({ msg, ctx })
    };
    const env = envOverrides({ ollamaVisionUrl: 'http://o', openrouterApiKey: 'sk' });
    selectProvider(env, logger);
    selectProvider(env, logger);
    selectProvider(env, logger);
    const chainLogs = infos.filter((m) => m.msg === 'ocr chain effective');
    expect(chainLogs).toHaveLength(1);
    expect(chainLogs[0].ctx?.providers).toEqual(['ollama-local', 'openrouter']);
  });

  it('re-emits when the chain composition changes between calls', () => {
    const infos: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];
    const logger = {
      warn: () => {},
      info: (msg: string, ctx?: Record<string, unknown>) => infos.push({ msg, ctx })
    };
    selectProvider(envOverrides({
      ollamaVisionUrl: 'http://o',
      openrouterApiKey: 'sk'
    }), logger);
    selectProvider(envOverrides({
      ollamaVisionUrl: 'http://o',
      ollamaCloudApiKey: 'sk-c'
    }), logger);
    const chainLogs = infos.filter((m) => m.msg === 'ocr chain effective');
    expect(chainLogs).toHaveLength(2);
    expect(chainLogs[0].ctx?.providers).toEqual(['ollama-local', 'openrouter']);
    expect(chainLogs[1].ctx?.providers).toEqual(['ollama-local', 'ollama-cloud']);
  });
});

describe('runOcrPipeline', () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

  function fakeProvider(payload: unknown): OcrProvider {
    return {
      name: 'ollama-local',
      estimateCostCents: () => 0,
      extract: async () => payload
    };
  }

  it('415 on non-image bytes', async () => {
    const r: PipelineOutcome = await runOcrPipeline({
      bytes: Buffer.from('plaintext-not-an-image'),
      mode: 'pump',
      provider: fakeProvider({ volume: 1, volumeUnit: 'gal', cost: 1, pricePerUnit: 1 }),
      env: envOverrides({ ollamaVisionUrl: 'x' })
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.statusCode).toBe(415);
  });

  it('400 on unknown mode', async () => {
    const r = await runOcrPipeline({
      bytes: JPEG,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mode: 'banana' as any,
      provider: fakeProvider({}),
      env: envOverrides({ ollamaVisionUrl: 'x' })
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.statusCode).toBe(400);
  });

  it('pump: 422 on range failure', async () => {
    const r = await runOcrPipeline({
      bytes: JPEG,
      mode: 'pump',
      provider: fakeProvider({ volume: 9999, volumeUnit: 'gal', cost: 1, pricePerUnit: 1 }),
      env: envOverrides({ ollamaVisionUrl: 'x' })
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.statusCode).toBe(422);
  });

  it('pump: 422 on cross-field drift', async () => {
    const r = await runOcrPipeline({
      bytes: JPEG,
      mode: 'pump',
      // 11.2 * 3.78 = 42.336; cost=100 → ~58% drift → fail
      provider: fakeProvider({ volume: 11.2, volumeUnit: 'gal', cost: 100, pricePerUnit: 3.78 }),
      env: envOverrides({ ollamaVisionUrl: 'x' })
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.statusCode).toBe(422);
      expect(r.error).toMatch(/cross-field/);
    }
  });

  it('502 on malformed provider payload', async () => {
    const r = await runOcrPipeline({
      bytes: JPEG,
      mode: 'pump',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provider: fakeProvider({ volume: 'string-not-number' } as any),
      env: envOverrides({ ollamaVisionUrl: 'x' })
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.statusCode).toBe(502);
  });

  it('502 when provider throws', async () => {
    const broken: OcrProvider = {
      name: 'ollama-local',
      estimateCostCents: () => 0,
      extract: async () => { throw new Error('boom'); }
    };
    const r = await runOcrPipeline({
      bytes: JPEG, mode: 'pump', provider: broken,
      env: envOverrides({ ollamaVisionUrl: 'x' })
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.statusCode).toBe(502);
  });

  it('pump: 200 on happy path with discriminated result', async () => {
    const r = await runOcrPipeline({
      bytes: JPEG,
      mode: 'pump',
      provider: fakeProvider({ volume: 11.2, volumeUnit: 'gal', cost: 42.18, pricePerUnit: 3.78 }),
      env: envOverrides({ ollamaVisionUrl: 'x' })
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.mode).toBe('pump');
      if (r.result.mode === 'pump') {
        expect(r.result.volume).toBe(11.2);
        expect(r.result.cost).toBe(42.18);
      }
      expect(r.imageType).toBe('jpeg');
    }
  });

  it('odometer: 200 on happy path', async () => {
    const r = await runOcrPipeline({
      bytes: JPEG,
      mode: 'odometer',
      provider: fakeProvider({ odometer: 87612 }),
      env: envOverrides({ ollamaVisionUrl: 'x' })
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.mode).toBe('odometer');
      if (r.result.mode === 'odometer') {
        expect(r.result.odometer).toBe(87612);
      }
    }
  });

  it('odometer: 422 on absurd reading', async () => {
    const r = await runOcrPipeline({
      bytes: JPEG,
      mode: 'odometer',
      provider: fakeProvider({ odometer: 5_000_000 }),
      env: envOverrides({ ollamaVisionUrl: 'x' })
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.statusCode).toBe(422);
  });

  it('odometer: forwards lastOdometerMi into the prompt when finite positive', async () => {
    let seenPrompt = '';
    const recordingProvider: OcrProvider = {
      name: 'ollama-local',
      estimateCostCents: () => 0,
      extract: async (_bytes, prompt) => {
        seenPrompt = prompt;
        return { odometer: 111120 };
      }
    };
    const r = await runOcrPipeline({
      bytes: JPEG,
      mode: 'odometer',
      provider: recordingProvider,
      env: envOverrides({ ollamaVisionUrl: 'x' }),
      lastOdometerMi: 111074
    });
    expect(r.ok).toBe(true);
    expect(seenPrompt).toMatch(/previous odometer reading/i);
    expect(seenPrompt).toContain('111074');
  });

  it('odometer: drops non-finite lastOdometerMi (no hint baked in)', async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -50]) {
      let seenPrompt = '';
      const recordingProvider: OcrProvider = {
        name: 'ollama-local',
        estimateCostCents: () => 0,
        extract: async (_bytes, prompt) => {
          seenPrompt = prompt;
          return { odometer: 87432 };
        }
      };
      const r = await runOcrPipeline({
        bytes: JPEG,
        mode: 'odometer',
        provider: recordingProvider,
        env: envOverrides({ ollamaVisionUrl: 'x' }),
        lastOdometerMi: bad
      });
      expect(r.ok).toBe(true);
      expect(seenPrompt).not.toMatch(/previous odometer reading/i);
    }
  });

  it('odometer: no hint when lastOdometerMi is unset', async () => {
    let seenPrompt = '';
    const recordingProvider: OcrProvider = {
      name: 'ollama-local',
      estimateCostCents: () => 0,
      extract: async (_bytes, prompt) => {
        seenPrompt = prompt;
        return { odometer: 87432 };
      }
    };
    const r = await runOcrPipeline({
      bytes: JPEG,
      mode: 'odometer',
      provider: recordingProvider,
      env: envOverrides({ ollamaVisionUrl: 'x' })
    });
    expect(r.ok).toBe(true);
    expect(seenPrompt).not.toMatch(/previous odometer reading/i);
  });

  it('pump: forwards lastPricePerUnit into the prompt when finite positive', async () => {
    let seenPrompt = '';
    const recordingProvider: OcrProvider = {
      name: 'ollama-local',
      estimateCostCents: () => 0,
      extract: async (_bytes, prompt) => {
        seenPrompt = prompt;
        return { volume: 11.2, volumeUnit: 'gal', cost: 42.18, pricePerUnit: 3.78 };
      }
    };
    const r = await runOcrPipeline({
      bytes: JPEG,
      mode: 'pump',
      provider: recordingProvider,
      env: envOverrides({ ollamaVisionUrl: 'x' }),
      lastPricePerUnit: 3.6789
    });
    expect(r.ok).toBe(true);
    expect(seenPrompt).toMatch(/most recent fuel price recorded/i);
    expect(seenPrompt).toContain('3.679');
  });

  it('pump: drops non-finite / zero / negative lastPricePerUnit (no hint baked in)', async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -2.5]) {
      let seenPrompt = '';
      const recordingProvider: OcrProvider = {
        name: 'ollama-local',
        estimateCostCents: () => 0,
        extract: async (_bytes, prompt) => {
          seenPrompt = prompt;
          return { volume: 11.2, volumeUnit: 'gal', cost: 42.18, pricePerUnit: 3.78 };
        }
      };
      const r = await runOcrPipeline({
        bytes: JPEG,
        mode: 'pump',
        provider: recordingProvider,
        env: envOverrides({ ollamaVisionUrl: 'x' }),
        lastPricePerUnit: bad
      });
      expect(r.ok).toBe(true);
      expect(seenPrompt).not.toMatch(/most recent fuel price recorded/i);
    }
  });

  it('pump: no hint when lastPricePerUnit is unset', async () => {
    let seenPrompt = '';
    const recordingProvider: OcrProvider = {
      name: 'ollama-local',
      estimateCostCents: () => 0,
      extract: async (_bytes, prompt) => {
        seenPrompt = prompt;
        return { volume: 11.2, volumeUnit: 'gal', cost: 42.18, pricePerUnit: 3.78 };
      }
    };
    const r = await runOcrPipeline({
      bytes: JPEG,
      mode: 'pump',
      provider: recordingProvider,
      env: envOverrides({ ollamaVisionUrl: 'x' })
    });
    expect(r.ok).toBe(true);
    expect(seenPrompt).not.toMatch(/most recent fuel price recorded/i);
  });
});

interface CapturedRec { level: string; msg: string; ctx: Record<string, unknown>; }
function captureLogger(): { logger: Logger; recs: CapturedRec[] } {
  const recs: CapturedRec[] = [];
  function mk(): Logger {
    const log = (level: string) => (msg: string, ctx?: Record<string, unknown>) =>
      void recs.push({ level, msg, ctx: ctx ?? {} });
    return {
      debug: log('debug') as Logger['debug'], info: log('info') as Logger['info'],
      warn: log('warn') as Logger['warn'], error: log('error') as Logger['error'],
      child: () => mk()
    };
  }
  return { logger: mk(), recs };
}

class FakeProvider implements OcrProvider {
  readonly name = 'ollama-local';
  estimateCostCents() { return 0; }
  constructor(private readonly impl: () => Promise<unknown>) {}
  async extract(): Promise<unknown> { return await this.impl(); }
}

describe('runOcrPipeline — branch logging', () => {
  const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const NOT_AN_IMAGE = Buffer.from('this is plain text bytes...');

  it('emits "ocr pipeline start" at debug', async () => {
    const provider = new FakeProvider(async () => ({ odometer: 12345 }));
    const { logger, recs } = captureLogger();
    await runOcrPipeline({
      bytes: JPEG_HEAD, mode: 'odometer', provider, env: envOverrides({}), logger
    });
    expect(recs.find((r) => r.msg === 'ocr pipeline start')?.level).toBe('debug');
  });

  it('emits "ocr unsupported image type" at warn for non-image bytes', async () => {
    const provider = new FakeProvider(async () => ({ odometer: 1 }));
    const { logger, recs } = captureLogger();
    await runOcrPipeline({
      bytes: NOT_AN_IMAGE, mode: 'odometer', provider, env: envOverrides({}), logger
    });
    const w = recs.find((r) => r.msg === 'ocr unsupported image type');
    expect(w?.level).toBe('warn');
  });

  it('emits "ocr unknown mode" at warn when mode is unknown', async () => {
    const provider = new FakeProvider(async () => ({}));
    const { logger, recs } = captureLogger();
    await runOcrPipeline({
      bytes: JPEG_HEAD, mode: 'bogus' as never, provider, env: envOverrides({}), logger
    });
    expect(recs.find((r) => r.msg === 'ocr unknown mode')?.level).toBe('warn');
  });

  it('emits "ocr provider failed" at error when extract throws', async () => {
    const provider = new FakeProvider(async () => { throw new Error('boom'); });
    const { logger, recs } = captureLogger();
    await runOcrPipeline({
      bytes: JPEG_HEAD, mode: 'odometer', provider, env: envOverrides({}), logger
    });
    const e = recs.find((r) => r.msg === 'ocr provider failed');
    expect(e?.level).toBe('error');
    expect((e?.ctx.err as Record<string, unknown>)?.message).toBe('boom');
  });

  it('emits "ocr schema invalid" with ocr_raw_full at warn when schema fails', async () => {
    const garbage = { not_what_we_asked_for: 42 };
    const provider = new FakeProvider(async () => garbage);
    const { logger, recs } = captureLogger();
    await runOcrPipeline({
      bytes: JPEG_HEAD, mode: 'odometer', provider, env: envOverrides({}), logger
    });
    const w = recs.find((r) => r.msg === 'ocr schema invalid');
    expect(w?.level).toBe('warn');
    expect(w?.ctx.ocr_raw_full).toEqual(garbage);
  });

  it('emits "ocr range validation failed" with ocr_raw_full at warn when ranges fail', async () => {
    const oversized = { volume: 9999, volumeUnit: 'gal', cost: 9999, pricePerUnit: 9999 };
    const provider = new FakeProvider(async () => oversized);
    const { logger, recs } = captureLogger();
    await runOcrPipeline({
      bytes: JPEG_HEAD, mode: 'pump', provider, env: envOverrides({}), logger
    });
    const w = recs.find((r) => r.msg === 'ocr range validation failed');
    expect(w?.level).toBe('warn');
    expect(w?.ctx.ocr_raw_full).toEqual(oversized);
  });

  it('emits "ocr success" at info on happy path', async () => {
    const provider = new FakeProvider(async () => ({ odometer: 12345 }));
    const { logger, recs } = captureLogger();
    await runOcrPipeline({
      bytes: JPEG_HEAD, mode: 'odometer', provider, env: envOverrides({}), logger
    });
    expect(recs.find((r) => r.msg === 'ocr success')?.level).toBe('info');
  });

  it('runs without a logger (no throw)', async () => {
    const provider = new FakeProvider(async () => ({ odometer: 1 }));
    await expect(
      runOcrPipeline({ bytes: JPEG_HEAD, mode: 'odometer', provider, env: envOverrides({}) })
    ).resolves.toBeDefined();
  });
});
