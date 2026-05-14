import { describe, it, expect } from 'vitest';
import {
  evaluateSmartChecks,
  ODOMETER_MAX_DELTA_MI,
  type SubmissionForCheck,
  type LastFuelupForCheck
} from './smart-checks';

const PREFS_ON = { smartChecksEnabled: true };
const PREFS_OFF = { smartChecksEnabled: false };

// Pin a deterministic "now" so check D is testable across CI time zones.
const FIXED_NOW = new Date('2026-05-14T12:00:00');

function sub(overrides: Partial<SubmissionForCheck> = {}): SubmissionForCheck {
  return {
    odometer: 87500,
    volume: 11.2,
    volumeUnit: 'gal',
    date: '2026-05-14',
    ...overrides
  };
}

function last(overrides: Partial<LastFuelupForCheck> = {}): LastFuelupForCheck {
  return { odometer: 87234, date: '2026-05-07', ...overrides };
}

describe('ODOMETER_MAX_DELTA_MI', () => {
  it('is the documented 2000 mi threshold', () => {
    expect(ODOMETER_MAX_DELTA_MI).toBe(2000);
  });
});

describe('evaluateSmartChecks — master toggle', () => {
  it('returns no issues when smartChecksEnabled is false (even when many would trigger)', () => {
    const result = evaluateSmartChecks(
      sub({ odometer: 100, volume: 0.1, date: '2099-01-01' }),
      last(),
      PREFS_OFF,
      FIXED_NOW
    );
    expect(result.issues).toEqual([]);
  });

  it('returns empty issues on a fully clean submission', () => {
    const result = evaluateSmartChecks(sub(), last(), PREFS_ON, FIXED_NOW);
    expect(result.issues).toEqual([]);
  });
});

describe('check A — submitted date ≥ last AND odometer lower', () => {
  it('fires when submitted odometer < last and date ≥ last', () => {
    const r = evaluateSmartChecks(
      sub({ odometer: 12400, date: '2026-05-14' }),
      last({ odometer: 45210, date: '2026-05-07' }),
      PREFS_ON,
      FIXED_NOW
    );
    expect(r.issues.map((i) => i.code)).toContain('A');
    const a = r.issues.find((i) => i.code === 'A')!;
    expect(a.message).toBe(
      'Odometer (12,400 mi) is lower than the last fillup (45,210 mi on May 7).'
    );
  });

  it('does not fire when odometer equals last on same date (zero delta)', () => {
    // A requires odometer < last strictly. Same date + same odo is C, not A.
    const r = evaluateSmartChecks(
      sub({ odometer: 45210, volume: 1, date: '2026-05-07' }),
      last({ odometer: 45210, date: '2026-05-07' }),
      PREFS_ON,
      FIXED_NOW
    );
    expect(r.issues.find((i) => i.code === 'A')).toBeUndefined();
  });

  it('skips silently when lastFuelup is null', () => {
    const r = evaluateSmartChecks(
      sub({ odometer: 100 }),
      null,
      PREFS_ON,
      FIXED_NOW
    );
    expect(r.issues.find((i) => i.code === 'A')).toBeUndefined();
  });
});

describe('check B — older date but higher odometer', () => {
  it('fires when submitted date < last and odometer > last', () => {
    const r = evaluateSmartChecks(
      sub({ odometer: 90000, date: '2026-05-01' }),
      last({ odometer: 87234, date: '2026-05-07' }),
      PREFS_ON,
      FIXED_NOW
    );
    const b = r.issues.find((i) => i.code === 'B');
    expect(b).toBeDefined();
    expect(b!.message).toBe(
      'Older date but higher odometer than the most recent fillup (87,234 mi on May 7).'
    );
  });

  it('does not fire when both date and odometer are older', () => {
    const r = evaluateSmartChecks(
      sub({ odometer: 80000, date: '2026-05-01' }),
      last({ odometer: 87234, date: '2026-05-07' }),
      PREFS_ON,
      FIXED_NOW
    );
    expect(r.issues.find((i) => i.code === 'B')).toBeUndefined();
  });

  it('skips silently when lastFuelup is null', () => {
    const r = evaluateSmartChecks(sub(), null, PREFS_ON, FIXED_NOW);
    expect(r.issues.find((i) => i.code === 'B')).toBeUndefined();
  });
});

describe('check C — same date, |Δ odometer| ≤ 5 (duplicate)', () => {
  it('fires when same date and |Δ| = 5 (inclusive at 5)', () => {
    const r = evaluateSmartChecks(
      sub({ odometer: 87239, date: '2026-05-07' }),
      last({ odometer: 87234, date: '2026-05-07' }),
      PREFS_ON,
      FIXED_NOW
    );
    const c = r.issues.find((i) => i.code === 'C');
    expect(c).toBeDefined();
    expect(c!.message).toBe('Looks like a duplicate of the May 7 fillup at 87,234 mi.');
  });

  it('fires when same date and |Δ| = 0', () => {
    const r = evaluateSmartChecks(
      sub({ odometer: 87234, date: '2026-05-07' }),
      last({ odometer: 87234, date: '2026-05-07' }),
      PREFS_ON,
      FIXED_NOW
    );
    expect(r.issues.find((i) => i.code === 'C')).toBeDefined();
  });

  it('does not fire when same date but |Δ| = 6 (exclusive past 5)', () => {
    const r = evaluateSmartChecks(
      sub({ odometer: 87240, date: '2026-05-07' }),
      last({ odometer: 87234, date: '2026-05-07' }),
      PREFS_ON,
      FIXED_NOW
    );
    expect(r.issues.find((i) => i.code === 'C')).toBeUndefined();
  });

  it('does not fire when dates differ even if |Δ| is small', () => {
    const r = evaluateSmartChecks(
      sub({ odometer: 87236, date: '2026-05-08' }),
      last({ odometer: 87234, date: '2026-05-07' }),
      PREFS_ON,
      FIXED_NOW
    );
    expect(r.issues.find((i) => i.code === 'C')).toBeUndefined();
  });

  it('skips silently when lastFuelup is null', () => {
    const r = evaluateSmartChecks(sub(), null, PREFS_ON, FIXED_NOW);
    expect(r.issues.find((i) => i.code === 'C')).toBeUndefined();
  });
});

describe('check D — future date', () => {
  it('fires when submitted date > today', () => {
    const r = evaluateSmartChecks(
      sub({ date: '2026-05-15' }),
      last(),
      PREFS_ON,
      new Date('2026-05-14T12:00:00')
    );
    const d = r.issues.find((i) => i.code === 'D');
    expect(d).toBeDefined();
    expect(d!.message).toBe('Date is in the future.');
  });

  it('does not fire when submitted date equals today', () => {
    const r = evaluateSmartChecks(
      sub({ date: '2026-05-14' }),
      last(),
      PREFS_ON,
      new Date('2026-05-14T23:59:59')
    );
    expect(r.issues.find((i) => i.code === 'D')).toBeUndefined();
  });

  it('fires regardless of lastFuelup being null', () => {
    const r = evaluateSmartChecks(
      sub({ date: '2099-01-01' }),
      null,
      PREFS_ON,
      FIXED_NOW
    );
    expect(r.issues.find((i) => i.code === 'D')).toBeDefined();
  });

  it('uses the injected now arg — fixed Date yields deterministic result', () => {
    // Same input, different "now" → different verdict.
    const earlier = evaluateSmartChecks(
      sub({ date: '2026-05-14' }),
      last(),
      PREFS_ON,
      new Date('2026-05-13T12:00:00')
    );
    const later = evaluateSmartChecks(
      sub({ date: '2026-05-14' }),
      last(),
      PREFS_ON,
      new Date('2026-05-14T12:00:00')
    );
    expect(earlier.issues.find((i) => i.code === 'D')).toBeDefined();
    expect(later.issues.find((i) => i.code === 'D')).toBeUndefined();
  });
});

describe('check E — odometer jump > 2000 mi', () => {
  it('does not fire at Δ = 2000 (strict >)', () => {
    const r = evaluateSmartChecks(
      sub({ odometer: 89234, date: '2026-05-14' }),
      last({ odometer: 87234, date: '2026-05-07' }),
      PREFS_ON,
      FIXED_NOW
    );
    expect(r.issues.find((i) => i.code === 'E')).toBeUndefined();
  });

  it('fires at Δ = 2001', () => {
    const r = evaluateSmartChecks(
      sub({ odometer: 89235, date: '2026-05-14' }),
      last({ odometer: 87234, date: '2026-05-07' }),
      PREFS_ON,
      FIXED_NOW
    );
    const e = r.issues.find((i) => i.code === 'E');
    expect(e).toBeDefined();
    expect(e!.message).toBe('Odometer is 2,001 mi above the last fillup — over 2,000 mi.');
  });

  it('skips silently when lastFuelup is null', () => {
    const r = evaluateSmartChecks(sub({ odometer: 999999 }), null, PREFS_ON, FIXED_NOW);
    expect(r.issues.find((i) => i.code === 'E')).toBeUndefined();
  });
});

describe('check G — tiny volume', () => {
  it('does not fire at exactly 0.5 gal (strict <)', () => {
    const r = evaluateSmartChecks(
      sub({ volume: 0.5, volumeUnit: 'gal' }),
      last(),
      PREFS_ON,
      FIXED_NOW
    );
    expect(r.issues.find((i) => i.code === 'G')).toBeUndefined();
  });

  it('fires at 0.49 gal with a "did you mean" suggestion', () => {
    const r = evaluateSmartChecks(
      sub({ volume: 0.49, volumeUnit: 'gal' }),
      last(),
      PREFS_ON,
      FIXED_NOW
    );
    const g = r.issues.find((i) => i.code === 'G');
    expect(g).toBeDefined();
    expect(g!.message).toBe('Volume (0.49) seems small — did you mean 4.9?');
  });

  it('fires at 0.5 L (gal-vs-L threshold differs)', () => {
    const r = evaluateSmartChecks(
      sub({ volume: 0.5, volumeUnit: 'L' }),
      last(),
      PREFS_ON,
      FIXED_NOW
    );
    expect(r.issues.find((i) => i.code === 'G')).toBeDefined();
  });

  it('does not fire at exactly 2 L (strict <)', () => {
    const r = evaluateSmartChecks(
      sub({ volume: 2, volumeUnit: 'L' }),
      last(),
      PREFS_ON,
      FIXED_NOW
    );
    expect(r.issues.find((i) => i.code === 'G')).toBeUndefined();
  });

  it('fires at 1.99 L', () => {
    const r = evaluateSmartChecks(
      sub({ volume: 1.99, volumeUnit: 'L' }),
      last(),
      PREFS_ON,
      FIXED_NOW
    );
    const g = r.issues.find((i) => i.code === 'G');
    expect(g).toBeDefined();
    // 1.99 has no leading zero before the decimal — spec says omit the suggestion.
    expect(g!.message).toBe('Volume (1.99) seems small.');
  });

  it('fires regardless of lastFuelup being null', () => {
    const r = evaluateSmartChecks(
      sub({ volume: 0.1, volumeUnit: 'gal' }),
      null,
      PREFS_ON,
      FIXED_NOW
    );
    expect(r.issues.find((i) => i.code === 'G')).toBeDefined();
  });
});

describe('aggregator', () => {
  it('returns issues in canonical order A, B, C, D, E, G when multiple fire', () => {
    // A + D + G is achievable: odometer lower than last (A), date in future (D),
    // volume 0.1 gal (G).
    const r = evaluateSmartChecks(
      sub({ odometer: 100, volume: 0.1, volumeUnit: 'gal', date: '2099-01-01' }),
      last({ odometer: 87234, date: '2026-05-07' }),
      PREFS_ON,
      FIXED_NOW
    );
    expect(r.issues.map((i) => i.code)).toEqual(['A', 'D', 'G']);
  });

  it('skips A/B/C/E silently when lastFuelup is null but still fires D and G', () => {
    const r = evaluateSmartChecks(
      sub({ odometer: 100, volume: 0.1, date: '2099-01-01' }),
      null,
      PREFS_ON,
      FIXED_NOW
    );
    expect(r.issues.map((i) => i.code)).toEqual(['D', 'G']);
  });

  it('year-boundary: last 2025-12-31, submitted 2026-01-01 with lower odo → A fires', () => {
    const r = evaluateSmartChecks(
      sub({ odometer: 100, date: '2026-01-01' }),
      last({ odometer: 50000, date: '2025-12-31' }),
      PREFS_ON,
      FIXED_NOW
    );
    expect(r.issues.find((i) => i.code === 'A')).toBeDefined();
  });
});
