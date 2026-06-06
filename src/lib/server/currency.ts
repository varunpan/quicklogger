import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { FxProviderName } from './env';
import type { Logger } from './logger';

const NOOP_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child() { return this; }
};

export interface FxCacheEntry {
  rate: number;
  fetchedAt: number;
  source: FxProviderName | 'identity' | 'manual';
}

export interface FxStore {
  load(): Promise<Record<string, FxCacheEntry>>;
  save(data: Record<string, FxCacheEntry>): Promise<void>;
}

export type FxFetcher = (
  provider: FxProviderName,
  from: string,
  to: string
) => Promise<{ rate: number }>;

export interface FxResult {
  rate: number;
  source: FxProviderName | 'identity' | 'manual';
  fetchedAt: number;
  stale: boolean;
  ageHours: number;
}

export class FxUnavailableError extends Error {
  constructor(message = 'No FX rate available') {
    super(message);
    this.name = 'FxUnavailableError';
  }
}

const FRESH_MAX_MS = 24 * 60 * 60 * 1000;
const STALE_MAX_MS = 7 * 24 * 60 * 60 * 1000;

interface Options {
  providers: FxProviderName[];
  fetcher: FxFetcher;
  store: FxStore;
  logger?: Logger;
}

function key(from: string, to: string): string {
  return `${from}:${to}`;
}

function ageMs(fetchedAt: number): number {
  return Date.now() - fetchedAt;
}

export class CurrencyService {
  private readonly log: Logger;
  constructor(private readonly opts: Options) {
    this.log = opts.logger ?? NOOP_LOGGER;
  }

  async getRate(from: string, to: string): Promise<FxResult> {
    if (from === to) {
      return { rate: 1, source: 'identity', fetchedAt: Date.now(), stale: false, ageHours: 0 };
    }

    let cache: Record<string, FxCacheEntry>;
    try {
      cache = await this.opts.store.load();
    } catch (err) {
      this.log.warn('fx cache read failed', { err });
      cache = {};
    }
    const cached = cache[key(from, to)];
    if (cached && ageMs(cached.fetchedAt) < FRESH_MAX_MS) {
      return this.toResult(cached, false);
    }

    for (const p of this.opts.providers) {
      try {
        const { rate } = await this.opts.fetcher(p, from, to);
        const entry: FxCacheEntry = { rate, fetchedAt: Date.now(), source: p };
        cache[key(from, to)] = entry;
        try {
          await this.opts.store.save(cache);
        } catch (err) {
          this.log.warn('fx cache write failed', { provider: p, err });
        }
        return this.toResult(entry, false);
      } catch (err) {
        this.log.warn('fx provider failed', { provider: p, err });
      }
    }

    if (cached && ageMs(cached.fetchedAt) < STALE_MAX_MS) {
      return this.toResult(cached, true);
    }

    throw new FxUnavailableError();
  }

  private toResult(entry: FxCacheEntry, stale: boolean): FxResult {
    return {
      rate: entry.rate,
      source: entry.source,
      fetchedAt: entry.fetchedAt,
      stale,
      ageHours: ageMs(entry.fetchedAt) / (60 * 60 * 1000)
    };
  }
}

export class JsonFileStore implements FxStore {
  constructor(private readonly path: string) {}
  async load() {
    try {
      const buf = await readFile(this.path, 'utf-8');
      return JSON.parse(buf) as Record<string, FxCacheEntry>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
  }
  async save(data: Record<string, FxCacheEntry>) {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(data, null, 2), 'utf-8');
  }
}

const TIMEOUT_MS = 3_000;

export const realFetcher: FxFetcher = async (provider, from, to) => {
  switch (provider) {
    case 'frankfurter': {
      const url = `https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`frankfurter ${res.status}`);
      const json = (await res.json()) as { rates: Record<string, number> };
      const rate = json.rates?.[to];
      if (!Number.isFinite(rate) || rate <= 0) throw new Error('frankfurter no rate');
      return { rate };
    }
    case 'erapi': {
      const url = `https://open.er-api.com/v6/latest/${from}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`erapi ${res.status}`);
      const json = (await res.json()) as { rates: Record<string, number> };
      const rate = json.rates?.[to];
      if (!Number.isFinite(rate) || rate <= 0) throw new Error('erapi no rate');
      return { rate };
    }
    case 'fawazahmed': {
      const lo = from.toLowerCase();
      const url = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${lo}.json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`fawazahmed ${res.status}`);
      const json = (await res.json()) as Record<string, Record<string, number>>;
      const rate = json[lo]?.[to.toLowerCase()];
      if (!Number.isFinite(rate) || rate <= 0) throw new Error('fawazahmed no rate');
      return { rate };
    }
    default:
      throw new Error(`Unknown provider ${provider}`);
  }
};
