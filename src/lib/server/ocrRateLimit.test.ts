import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OcrRateLimiter } from './ocrRateLimit';

describe('OcrRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('allows up to N requests per hour per key', () => {
    const rl = new OcrRateLimiter({ perHour: 3 });
    expect(rl.check('1.2.3.4')).toEqual({ allowed: true });
    expect(rl.check('1.2.3.4')).toEqual({ allowed: true });
    expect(rl.check('1.2.3.4')).toEqual({ allowed: true });
    const blocked = rl.check('1.2.3.4');
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterSec).toBeGreaterThan(0);
      expect(blocked.retryAfterSec).toBeLessThanOrEqual(3600);
    }
  });

  it('isolates buckets by key', () => {
    const rl = new OcrRateLimiter({ perHour: 1 });
    expect(rl.check('a').allowed).toBe(true);
    expect(rl.check('b').allowed).toBe(true);
    expect(rl.check('a').allowed).toBe(false);
    expect(rl.check('b').allowed).toBe(false);
  });

  it('drops requests outside the rolling 1-hour window', () => {
    const rl = new OcrRateLimiter({ perHour: 2 });
    expect(rl.check('a').allowed).toBe(true);
    expect(rl.check('a').allowed).toBe(true);
    expect(rl.check('a').allowed).toBe(false);
    vi.advanceTimersByTime(61 * 60 * 1000);
    expect(rl.check('a').allowed).toBe(true);
  });

  it('reports retryAfterSec relative to the oldest request in the window', () => {
    const rl = new OcrRateLimiter({ perHour: 1 });
    rl.check('a');
    vi.advanceTimersByTime(15 * 60 * 1000);
    const r = rl.check('a');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.retryAfterSec).toBe(45 * 60);
  });
});
