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

  it('evicts keys whose hits have all expired once the sweep interval elapses', () => {
    // Keys for IPs that never return used to live forever — check() only
    // rewrites the caller's own key.
    const rl = new OcrRateLimiter({ perHour: 5 });
    rl.check('a');
    rl.check('b');
    expect(rl.trackedKeyCount).toBe(2);
    vi.advanceTimersByTime(61 * 60 * 1000);
    rl.check('c'); // triggers the sweep; a and b are fully outside the window
    expect(rl.trackedKeyCount).toBe(1);
    // c is still tracked and functional.
    expect(rl.check('c').allowed).toBe(true);
  });

  it('the sweep keeps keys that still have hits inside the window', () => {
    const rl = new OcrRateLimiter({ perHour: 5 });
    rl.check('a');
    rl.check('b');
    vi.advanceTimersByTime(30 * 60 * 1000);
    rl.check('a'); // fresh hit for a at t+30min; b stays idle
    vi.advanceTimersByTime(31 * 60 * 1000);
    rl.check('c'); // sweep at t+61min: b fully expired, a's t+30min hit survives
    expect(rl.trackedKeyCount).toBe(2); // a + c
  });
});
