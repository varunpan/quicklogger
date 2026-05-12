import { describe, it, expect } from 'vitest';
import { sniffImageType, selectProvider, runOcrPipeline, type PipelineOutcome } from './ocr';
import { ChainOcrProvider, type OcrProvider } from './ocrProviders';
import type { Env } from './env';

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
    ocrDailyBudgetUsd: 1, ocrRateLimitPerHour: 20,
    ocrBudgetPath: '/tmp/b.json', ocrAuditPath: '/tmp/a.jsonl',
    ocrAuditKeyPath: '/tmp/k.txt', ocrAuditHmacKey: undefined,
    ocrPumpVolumeMax: 200, ocrPumpCostMax: 500, ocrPumpPricePerUnitMax: 20,
    ocrOdometerMaxMi: 1_000_000,
    ...o
  };
}

describe('selectProvider', () => {
  it('returns null when neither provider is configured', () => {
    expect(selectProvider(envOverrides({}))).toBeNull();
  });
  it('returns ollama-only when only ollama is set', () => {
    const p = selectProvider(envOverrides({ ollamaVisionUrl: 'http://o' }));
    expect(p?.name).toBe('ollama');
    expect(p).not.toBeInstanceOf(ChainOcrProvider);
  });
  it('returns openrouter-only when only openrouter is set', () => {
    const p = selectProvider(envOverrides({ openrouterApiKey: 'sk' }));
    expect(p?.name).toBe('openrouter');
    expect(p).not.toBeInstanceOf(ChainOcrProvider);
  });
  it('returns a chain when both are set, ollama first', () => {
    const p = selectProvider(envOverrides({ ollamaVisionUrl: 'http://o', openrouterApiKey: 'sk' }));
    expect(p).toBeInstanceOf(ChainOcrProvider);
    if (p instanceof ChainOcrProvider) {
      expect(p.chain[0].name).toBe('ollama');
      expect(p.chain[1].name).toBe('openrouter');
    }
  });
});

describe('runOcrPipeline', () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

  function fakeProvider(payload: unknown): OcrProvider {
    return {
      name: 'ollama',
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
      name: 'ollama',
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
});
