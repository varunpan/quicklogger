export interface OcrRateLimiterOptions {
  perHour: number;
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number };

const HOUR_MS = 60 * 60 * 1000;

export class OcrRateLimiter {
  private readonly perHour: number;
  private readonly hits = new Map<string, number[]>();

  constructor(opts: OcrRateLimiterOptions) {
    this.perHour = opts.perHour;
  }

  check(key: string): RateLimitResult {
    const now = Date.now();
    const cutoff = now - HOUR_MS;
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
