import { describe, it, expect } from 'vitest';
import { MODES, type ModeContract } from './ocrModes';
import type { Env } from './env';

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    lubeloggerUrl: 'http://l', lubeloggerApiKey: 'k',
    lubeloggerVolumeUnit: 'gallons_us', lubeloggerCurrency: 'USD',
    fxProviders: ['frankfurter'],
    fxCachePath: '/tmp/fx', port: 3000, origin: undefined,
    ollamaVisionUrl: undefined, ollamaVisionModel: 'qwen2.5vl:3b',
    ollamaVisionTimeoutMs: 60_000, ollamaKeepAlive: '30m',
    openrouterApiKey: undefined, openrouterVisionModel: 'google/gemini-2.5-flash-lite',
    openrouterVisionTimeoutMs: 30_000,
    ocrDailyBudgetUsd: 1, ocrRateLimitPerHour: 20,
    ocrBudgetPath: '/tmp/b.json', ocrAuditPath: '/tmp/a.jsonl',
    ocrAuditKeyPath: '/tmp/k.txt', ocrAuditHmacKey: undefined,
    ocrPumpVolumeMax: 200, ocrPumpCostMax: 500, ocrPumpPricePerUnitMax: 20,
    ocrOdometerMaxMi: 1_000_000,
    ...overrides
  };
}

describe('MODES map', () => {
  it('has entries for pump and odometer only', () => {
    expect(Object.keys(MODES).sort()).toEqual(['odometer', 'pump']);
  });

  it('every contract exposes prompt, schema, validateSchema, validateRanges', () => {
    for (const m of Object.values(MODES) as ModeContract[]) {
      expect(typeof m.prompt).toBe('string');
      expect(m.prompt.length).toBeGreaterThan(20);
      expect(typeof m.schema).toBe('object');
      expect(typeof m.validateSchema).toBe('function');
      expect(typeof m.validateRanges).toBe('function');
    }
  });
});

describe('pump contract', () => {
  const pump = MODES.pump;

  it('validateSchema accepts a complete pump payload', () => {
    const r = pump.validateSchema({
      volume: 11.234, volumeUnit: 'gal', cost: 42.18, pricePerUnit: 3.78
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.mode).toBe('pump');
      expect(r.value.volume).toBe(11.234);
      expect(r.value.volumeUnit).toBe('gal');
    }
  });

  it('validateSchema rejects a missing field', () => {
    const r = pump.validateSchema({ volume: 11, volumeUnit: 'gal', cost: 42 });
    expect(r.ok).toBe(false);
  });

  it('validateSchema rejects a wrong type', () => {
    const r = pump.validateSchema({
      volume: '11', volumeUnit: 'gal', cost: 42, pricePerUnit: 3.78
    });
    expect(r.ok).toBe(false);
  });

  it('validateSchema rejects an unknown volumeUnit', () => {
    const r = pump.validateSchema({
      volume: 11, volumeUnit: 'imperial-gal', cost: 42, pricePerUnit: 3.78
    });
    expect(r.ok).toBe(false);
  });

  it('validateRanges accepts realistic values', () => {
    const env = fakeEnv();
    expect(pump.validateRanges({
      mode: 'pump', volume: 11.2, volumeUnit: 'gal', cost: 42.18, pricePerUnit: 3.78
    }, env).ok).toBe(true);
  });

  it('validateRanges rejects volume out of bounds', () => {
    const env = fakeEnv();
    expect(pump.validateRanges({
      mode: 'pump', volume: 0, volumeUnit: 'gal', cost: 1, pricePerUnit: 1
    }, env).ok).toBe(false);
    expect(pump.validateRanges({
      mode: 'pump', volume: 999, volumeUnit: 'gal', cost: 1, pricePerUnit: 1
    }, env).ok).toBe(false);
  });

  it('validateRanges respects env overrides', () => {
    const env = fakeEnv({ ocrPumpVolumeMax: 50 });
    expect(pump.validateRanges({
      mode: 'pump', volume: 100, volumeUnit: 'gal', cost: 1, pricePerUnit: 1
    }, env).ok).toBe(false);
  });

  it('validateCrossField passes within 5% drift', () => {
    if (!pump.validateCrossField) throw new Error('pump must have validateCrossField');
    // 11.2 * 3.78 = 42.336; observed 42.18 → drift = 0.37% → ok
    expect(pump.validateCrossField({
      mode: 'pump', volume: 11.2, volumeUnit: 'gal', cost: 42.18, pricePerUnit: 3.78
    }).ok).toBe(true);
  });

  it('validateCrossField fails on > 5% drift', () => {
    if (!pump.validateCrossField) throw new Error('pump must have validateCrossField');
    // 11.2 * 3.78 = 42.336; observed 100 → drift = ~58% → fail
    expect(pump.validateCrossField({
      mode: 'pump', volume: 11.2, volumeUnit: 'gal', cost: 100, pricePerUnit: 3.78
    }).ok).toBe(false);
  });
});

describe('odometer contract', () => {
  const odo = MODES.odometer;

  it('validateSchema accepts a single odometer field', () => {
    const r = odo.validateSchema({ odometer: 87432 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.mode).toBe('odometer');
      expect(r.value.odometer).toBe(87432);
    }
  });

  it('validateSchema rejects a missing odometer', () => {
    expect(odo.validateSchema({}).ok).toBe(false);
  });

  it('validateSchema rejects wrong type', () => {
    expect(odo.validateSchema({ odometer: '87,432' }).ok).toBe(false);
  });

  it('validateRanges accepts realistic odometer', () => {
    const env = fakeEnv();
    expect(odo.validateRanges({ mode: 'odometer', odometer: 87432 }, env).ok).toBe(true);
  });

  it('validateRanges rejects 0 and absurdly large', () => {
    const env = fakeEnv();
    expect(odo.validateRanges({ mode: 'odometer', odometer: 0 }, env).ok).toBe(false);
    expect(odo.validateRanges({ mode: 'odometer', odometer: 2_000_000 }, env).ok).toBe(false);
  });

  it('has no validateCrossField (single field)', () => {
    expect(odo.validateCrossField).toBeUndefined();
  });
});
