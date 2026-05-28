import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  formatOdometer,
  daysAgo,
  formatLastFillupDate,
  humanCountdown,
  formatDueDate,
  formatIsoDate,
  formatCost
} from './format';

// Helpers ---------------------------------------------------------------

function seedServerInfo(overrides: Record<string, unknown> = {}) {
  const base = {
    reachable: true, status: 'ok', currentVersion: '1.6.5', latestVersion: '1.6.5',
    updateAvailable: false, locale: 'en-US', currencySymbol: '$',
    decimalSeparator: '.', dateFormat: 'M/d/yyyy', lubeloggerCurrency: 'USD'
  };
  localStorage.setItem('quicklogger-server-info', JSON.stringify({ ...base, ...overrides }));
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

// formatOdometer --------------------------------------------------------

describe('formatOdometer', () => {
  it('formats a numeric string with thousands separators (en-US default)', () => {
    expect(formatOdometer('87432')).toBe('87,432');
  });
  it('rounds decimals to whole miles', () => {
    expect(formatOdometer('87432.5')).toBe('87,433');
  });
  it('uses cached locale (de-DE → dots as thousands separator)', () => {
    seedServerInfo({ locale: 'de-DE' });
    expect(formatOdometer('87432')).toBe(new Intl.NumberFormat('de-DE').format(87432));
  });
  it('returns input unchanged when not parseable', () => {
    expect(formatOdometer('not-a-number')).toBe('not-a-number');
  });
  it('handles empty input', () => {
    expect(formatOdometer('')).toBe('');
  });
});

// daysAgo ---------------------------------------------------------------

describe('daysAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T15:00:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('returns "today" for the same calendar day', () => {
    expect(daysAgo('2026-05-10')).toBe('today');
  });
  it('returns "yesterday" for 1 day ago', () => {
    expect(daysAgo('2026-05-09')).toBe('yesterday');
  });
  it('returns "N days ago" for 2+ days', () => {
    expect(daysAgo('2026-05-03')).toBe('7 days ago');
  });
  it('returns raw input when unparseable', () => {
    expect(daysAgo('not a date')).toBe('not a date');
  });
});

// formatLastFillupDate --------------------------------------------------

describe('formatLastFillupDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T15:00:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('combines absolute date with "today" (en-US fallback)', () => {
    expect(formatLastFillupDate('2026-05-10')).toBe('May 10, 2026 (today)');
  });
  it('combines absolute date with "yesterday"', () => {
    expect(formatLastFillupDate('2026-05-09')).toBe('May 9, 2026 (yesterday)');
  });
  it('combines absolute date with "N days ago"', () => {
    expect(formatLastFillupDate('2026-05-03')).toBe('May 3, 2026 (7 days ago)');
  });
  it('uses cached locale for absolute date (en-GB → D Mon)', () => {
    seedServerInfo({ locale: 'en-GB' });
    const got = formatLastFillupDate('2026-01-02');
    // en-GB short month is "2 Jan 2026"; suffix unchanged.
    const expectedAbs = new Date(2026, 0, 2).toLocaleDateString('en-GB', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
    expect(got).toBe(`${expectedAbs} (128 days ago)`);
  });
  it('returns raw input when empty', () => {
    expect(formatLastFillupDate('')).toBe('');
  });
  it('returns raw input when not three segments', () => {
    expect(formatLastFillupDate('2026-05')).toBe('2026-05');
  });
  it('returns raw input on non-numeric segments', () => {
    expect(formatLastFillupDate('2026-foo-10')).toBe('2026-foo-10');
  });
  it('returns raw input on unparseable', () => {
    expect(formatLastFillupDate('not a date')).toBe('not a date');
  });
});

// humanCountdown --------------------------------------------------------

describe('humanCountdown', () => {
  it('renders positive day counts as "N days to go"', () => {
    expect(humanCountdown(7, 'days')).toBe('7 days to go');
  });
  it('renders negative day counts as "N days overdue"', () => {
    expect(humanCountdown(-44, 'days')).toBe('44 days overdue');
  });
  it('renders zero days as "due today"', () => {
    expect(humanCountdown(0, 'days')).toBe('due today');
  });
  it('renders positive mile counts with locale thousands sep', () => {
    expect(humanCountdown(5764, 'mi')).toBe('5,764 mi to go');
  });
  it('renders negative mile counts as "N mi overdue"', () => {
    expect(humanCountdown(-712, 'mi')).toBe('712 mi overdue');
  });
  it('renders zero miles as "due now"', () => {
    expect(humanCountdown(0, 'mi')).toBe('due now');
  });
  it('accepts numeric strings', () => {
    expect(humanCountdown('-31', 'days')).toBe('31 days overdue');
    expect(humanCountdown('5764', 'mi')).toBe('5,764 mi to go');
  });
  it('returns empty for non-finite / non-numeric', () => {
    expect(humanCountdown(NaN, 'days')).toBe('');
    expect(humanCountdown(Infinity, 'mi')).toBe('');
    expect(humanCountdown('not-a-number', 'days')).toBe('');
  });
  it('uses locale thousands separators on miles', () => {
    expect(humanCountdown(12500, 'mi')).toBe('12,500 mi to go');
  });
});

// formatDueDate ---------------------------------------------------------

describe('formatDueDate', () => {
  it('formats ISO date as "Mon D, YYYY" (en-US default)', () => {
    expect(formatDueDate('2026-04-12')).toBe('Apr 12, 2026');
  });
  it('formats single-digit month and day', () => {
    expect(formatDueDate('2026-01-02')).toBe('Jan 2, 2026');
  });
  it('uses cached locale', () => {
    seedServerInfo({ locale: 'en-GB' });
    const expected = new Date(2026, 3, 12).toLocaleDateString('en-GB', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
    expect(formatDueDate('2026-04-12')).toBe(expected);
  });
  it('returns raw input when empty', () => {
    expect(formatDueDate('')).toBe('');
  });
  it('returns raw input when not three segments', () => {
    expect(formatDueDate('2026-05')).toBe('2026-05');
  });
  it('returns raw input on non-numeric segments', () => {
    expect(formatDueDate('2026-foo-12')).toBe('2026-foo-12');
  });
});

// formatIsoDate ---------------------------------------------------------

describe('formatIsoDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T10:00:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('combines absolute date with "today"', () => {
    expect(formatIsoDate('2026-05-13')).toBe('May 13, 2026 · today');
  });
  it('combines absolute date with "yesterday"', () => {
    expect(formatIsoDate('2026-05-12')).toBe('May 12, 2026 · yesterday');
  });
  it('combines absolute date with "N days ago"', () => {
    expect(formatIsoDate('2026-05-06')).toBe('May 6, 2026 · 7 days ago');
  });
  it('returns raw input on non-date input', () => {
    expect(formatIsoDate('not-a-date')).toBe('not-a-date');
  });
  it('returns raw input on empty', () => {
    expect(formatIsoDate('')).toBe('');
  });
  it('returns raw input when not three segments', () => {
    expect(formatIsoDate('2026-05')).toBe('2026-05');
  });
});

// formatCost ------------------------------------------------------------

describe('formatCost', () => {
  it('uses provided currency code (en-US default)', () => {
    expect(formatCost(50.96, 'USD')).toBe(
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(50.96)
    );
  });
  it('falls back to cached lubeloggerCurrency when currencyCode is null', () => {
    seedServerInfo({ lubeloggerCurrency: 'EUR', locale: 'de-DE' });
    expect(formatCost(50.96, null)).toBe(
      new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(50.96)
    );
  });
  it('falls back to USD when cache is empty', () => {
    expect(formatCost(42.18, null)).toBe(
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(42.18)
    );
  });
  it('returns empty for non-finite cost', () => {
    expect(formatCost(NaN, 'USD')).toBe('');
    expect(formatCost(Infinity, 'USD')).toBe('');
  });
  it('SSR-safe — works when localStorage is undefined', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(formatCost(50.96, 'USD')).toBe(
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(50.96)
    );
  });
});
