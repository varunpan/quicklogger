import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadEnv, EnvError } from './env';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('LUBELOGGER_') || k.startsWith('FX_')) {
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
