import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CurrencyService,
  JsonFileStore,
  realFetcher,
  type FxFetcher,
  type FxStore,
  type FxCacheEntry
} from './currency';
import type { Logger } from './logger';

type LogCall = { level: string; msg: string; ctx: Record<string, unknown> };

function captureLogger(): { logger: Logger; calls: LogCall[] } {
  const calls: LogCall[] = [];
  const log = (level: string) => (msg: string, ctx?: Record<string, unknown>) =>
    void calls.push({ level, msg, ctx: ctx ?? {} });
  const logger = {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    child() { return this; }
  } as unknown as Logger;
  return { logger, calls };
}

function inMemoryStore(initial?: Record<string, FxCacheEntry>): FxStore {
  let data: Record<string, FxCacheEntry> = { ...(initial ?? {}) };
  return {
    async load() { return data; },
    async update(mutator) { data = mutator({ ...data }); }
  };
}

const HOUR = 60 * 60 * 1000;

describe('CurrencyService', () => {
  const now = new Date('2026-05-07T12:00:00Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  it('returns cached rate on hit (< 24h old)', async () => {
    const store = inMemoryStore({
      'USD:CAD': { rate: 1.36, fetchedAt: now - 2 * HOUR, source: 'frankfurter' }
    });
    const fetcher: FxFetcher = vi.fn();
    const svc = new CurrencyService({ providers: ['frankfurter', 'erapi'], fetcher, store });
    const result = await svc.getRate('USD', 'CAD');
    expect(result).toEqual({
      rate: 1.36, source: 'frankfurter', fetchedAt: now - 2 * HOUR, stale: false, ageHours: 2
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('walks the provider chain and stops at first success', async () => {
    const fetcher: FxFetcher = vi.fn(async (provider, _from, _to) => {
      if (provider === 'frankfurter') throw new Error('503');
      if (provider === 'erapi') return { rate: 1.37 };
      throw new Error('should not reach fawazahmed');
    });
    const svc = new CurrencyService({ providers: ['frankfurter', 'erapi', 'fawazahmed'], fetcher, store: inMemoryStore() });
    const result = await svc.getRate('USD', 'CAD');
    expect(result.rate).toBe(1.37);
    expect(result.source).toBe('erapi');
    expect(result.stale).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('returns stale cache when all providers fail', async () => {
    const cachedAt = now - 10 * HOUR;
    const store = inMemoryStore({ 'USD:CAD': { rate: 1.34, fetchedAt: cachedAt, source: 'frankfurter' } });
    const fetcher: FxFetcher = vi.fn(async () => { throw new Error('down'); });
    const svc = new CurrencyService({ providers: ['frankfurter', 'erapi', 'fawazahmed'], fetcher, store });
    vi.setSystemTime(now + 25 * HOUR);
    const result = await svc.getRate('USD', 'CAD');
    expect(result.rate).toBe(1.34);
    expect(result.stale).toBe(true);
    expect(result.source).toBe('frankfurter');
    expect(result.ageHours).toBeGreaterThan(24);
  });

  it('signals unavailable when all providers fail and no cache', async () => {
    const fetcher: FxFetcher = vi.fn(async () => { throw new Error('down'); });
    const svc = new CurrencyService({ providers: ['frankfurter', 'erapi'], fetcher, store: inMemoryStore() });
    await expect(svc.getRate('USD', 'CAD')).rejects.toMatchObject({ name: 'FxUnavailableError' });
  });

  it('treats cache older than 7 days as unavailable', async () => {
    const eightDays = 8 * 24 * HOUR;
    const store = inMemoryStore({ 'USD:CAD': { rate: 1.30, fetchedAt: now - eightDays, source: 'frankfurter' } });
    const fetcher: FxFetcher = vi.fn(async () => { throw new Error('down'); });
    const svc = new CurrencyService({ providers: ['frankfurter'], fetcher, store });
    await expect(svc.getRate('USD', 'CAD')).rejects.toMatchObject({ name: 'FxUnavailableError' });
  });

  it('passes through identity when from === to', async () => {
    const fetcher: FxFetcher = vi.fn();
    const svc = new CurrencyService({ providers: ['frankfurter'], fetcher, store: inMemoryStore() });
    const result = await svc.getRate('USD', 'USD');
    expect(result.rate).toBe(1);
    expect(result.source).toBe('identity');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('persists fresh fetch to store on success', async () => {
    const store = inMemoryStore();
    const fetcher: FxFetcher = vi.fn(async () => ({ rate: 1.36 }));
    const svc = new CurrencyService({ providers: ['frankfurter'], fetcher, store });
    await svc.getRate('USD', 'CAD');
    const persisted = await store.load();
    expect(persisted['USD:CAD']).toMatchObject({ rate: 1.36, source: 'frankfurter' });
  });

  it('logs a warn when a provider throws and the chain falls back', async () => {
    const { logger, calls } = captureLogger();
    const fetcher: FxFetcher = vi.fn(async (provider) => {
      if (provider === 'frankfurter') throw new Error('boom');
      return { rate: 1.07 };
    });
    const svc = new CurrencyService({
      providers: ['frankfurter', 'erapi'],
      fetcher,
      store: inMemoryStore(),
      logger
    });
    const r = await svc.getRate('USD', 'EUR');
    expect(r.rate).toBe(1.07);
    expect(
      calls.some((c) => c.level === 'warn' && c.msg === 'fx provider failed')
    ).toBe(true);
  });

  it('logs a warn when FX cache read fails and falls back to a fresh fetch', async () => {
    const { logger, calls } = captureLogger();
    const store: FxStore = {
      async load() { throw new Error('disk gone'); },
      async update() {}
    };
    const fetcher: FxFetcher = vi.fn(async () => ({ rate: 1.42 }));
    const svc = new CurrencyService({ providers: ['frankfurter'], fetcher, store, logger });
    const r = await svc.getRate('USD', 'CAD');
    expect(r.rate).toBe(1.42);
    expect(
      calls.some((c) => c.level === 'warn' && c.msg === 'fx cache read failed')
    ).toBe(true);
  });

  it('logs a warn when FX cache write fails but still returns the fresh rate', async () => {
    const { logger, calls } = captureLogger();
    const store: FxStore = {
      async load() { return {}; },
      async update() { throw new Error('disk full'); }
    };
    const fetcher: FxFetcher = vi.fn(async () => ({ rate: 1.42 }));
    const svc = new CurrencyService({ providers: ['frankfurter'], fetcher, store, logger });
    const r = await svc.getRate('USD', 'CAD');
    expect(r.rate).toBe(1.42);
    expect(
      calls.some((c) => c.level === 'warn' && c.msg === 'fx cache write failed')
    ).toBe(true);
  });
});

describe('CurrencyService — concurrency (real file store)', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fx-cache-'));
    path = join(dir, 'fx-cache.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('does not lose a concurrently-written entry for a different pair', async () => {
    // The bug: getRate loads the whole cache, adds one key, saves the whole
    // map. Two concurrent lookups for different pairs each save a single-key
    // map and the second clobbers the first. The locked merge must keep both.
    const store = new JsonFileStore(path);
    const fetcher: FxFetcher = async (_p, _from, to) => ({ rate: to === 'CAD' ? 1.36 : 1.09 });
    const svc = new CurrencyService({ providers: ['frankfurter'], fetcher, store });
    await Promise.all([svc.getRate('USD', 'CAD'), svc.getRate('USD', 'EUR')]);
    const persisted = await store.load();
    expect(Object.keys(persisted).sort()).toEqual(['USD:CAD', 'USD:EUR']);
  });
});

describe('realFetcher — rate validation', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function stubFetchJson(payload: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })
      )
    );
  }

  it('rejects NaN / 0 / negative provider rates as "no rate"', async () => {
    for (const bad of [Number.NaN, 0, -1]) {
      stubFetchJson({ rates: { CAD: bad } });
      await expect(realFetcher('frankfurter', 'USD', 'CAD')).rejects.toThrow('frankfurter no rate');
    }
  });

  it('accepts a finite, positive provider rate', async () => {
    stubFetchJson({ rates: { CAD: 1.36 } });
    await expect(realFetcher('frankfurter', 'USD', 'CAD')).resolves.toEqual({ rate: 1.36 });
  });
});
