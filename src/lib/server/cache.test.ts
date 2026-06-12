import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TtlCache } from './cache';

describe('TtlCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the cached value within TTL', async () => {
    const cache = new TtlCache<string>(5_000);
    let calls = 0;
    const get = () => cache.get('k', async () => { calls++; return 'v'; });
    expect(await get()).toBe('v');
    expect(await get()).toBe('v');
    expect(calls).toBe(1);
  });

  it('refetches after TTL expires', async () => {
    const cache = new TtlCache<string>(5_000);
    let calls = 0;
    const get = () => cache.get('k', async () => { calls++; return `v${calls}`; });
    expect(await get()).toBe('v1');
    vi.advanceTimersByTime(6_000);
    expect(await get()).toBe('v2');
  });

  it('isolates entries by key', async () => {
    const cache = new TtlCache<number>(5_000);
    expect(await cache.get('a', async () => 1)).toBe(1);
    expect(await cache.get('b', async () => 2)).toBe(2);
    expect(await cache.get('a', async () => 99)).toBe(1);
  });

  it('dedupes concurrent misses into a single fetch (single-flight)', async () => {
    const cache = new TtlCache<string>(5_000);
    let calls = 0;
    const fetcher = () => {
      calls++;
      return new Promise<string>((r) => setTimeout(() => r('v'), 100));
    };
    // Fire three gets before any resolves — without in-flight dedup each would
    // call fetcher() (thundering herd). They must share one in-flight fetch.
    const all = Promise.all([
      cache.get('k', fetcher),
      cache.get('k', fetcher),
      cache.get('k', fetcher)
    ]);
    await vi.advanceTimersByTimeAsync(100);
    expect(await all).toEqual(['v', 'v', 'v']);
    expect(calls).toBe(1);
  });

  it('does not cache a rejected fetch — a later call retries', async () => {
    const cache = new TtlCache<string>(5_000);
    let calls = 0;
    const fetcher = () => {
      calls++;
      return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve('ok');
    };
    await expect(cache.get('k', fetcher)).rejects.toThrow('boom');
    // A rejected fetch must be evicted, not replayed for the whole TTL window.
    expect(await cache.get('k', fetcher)).toBe('ok');
    expect(calls).toBe(2);
  });
});
