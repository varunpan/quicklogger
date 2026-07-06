import type { Logger } from './logger';

const NOOP_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child() { return this; }
};

export interface OcrRateLimiterOptions {
  perHour: number;
  logger?: Logger;
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number };

const HOUR_MS = 60 * 60 * 1000;

export class OcrRateLimiter {
  private readonly perHour: number;
  private readonly log: Logger;
  private readonly hits = new Map<string, number[]>();
  private lastSweepAt = Date.now();

  constructor(opts: OcrRateLimiterOptions) {
    this.perHour = opts.perHour;
    this.log = opts.logger ?? NOOP_LOGGER;
  }

  /** Test-only visibility: number of keys currently held in the map. */
  get trackedKeyCount(): number {
    return this.hits.size;
  }

  // Opportunistic eviction. `check()` only ever rewrites the *caller's* key,
  // so an IP that never returns would hold its (fully expired) hit array
  // forever — an unbounded map on a long-lived process. At most once per
  // window, drop every key whose hits are all outside it. O(n) over the map,
  // amortized to once an hour regardless of call rate.
  private maybeSweep(now: number, cutoff: number): void {
    if (now - this.lastSweepAt < HOUR_MS) return;
    this.lastSweepAt = now;
    for (const [key, arr] of this.hits) {
      if (!arr.some((t) => t > cutoff)) this.hits.delete(key);
    }
  }

  check(key: string): RateLimitResult {
    const now = Date.now();
    const cutoff = now - HOUR_MS;
    this.maybeSweep(now, cutoff);
    const arr = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (arr.length >= this.perHour) {
      const oldest = arr[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldest + HOUR_MS - now) / 1000));
      this.hits.set(key, arr);
      return { allowed: false, retryAfterSec };
    }

    arr.push(now);
    this.hits.set(key, arr);
    return { allowed: true };
  }

  reset() {
    this.hits.clear();
  }
}
