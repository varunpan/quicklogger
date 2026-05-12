import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatOdometer, daysAgo, formatLastFillupDate } from './format';

describe('formatOdometer', () => {
  it('formats a numeric string with thousands separators', () => {
    expect(formatOdometer('87432')).toBe('87,432');
  });

  it('parses LubeLogger decimal odometers and rounds to whole miles', () => {
    expect(formatOdometer('87432.5')).toBe('87,433');
  });

  it('returns the input unchanged when not parseable as a number', () => {
    expect(formatOdometer('not-a-number')).toBe('not-a-number');
  });

  it('handles empty inputs', () => {
    expect(formatOdometer('')).toBe('');
  });
});

describe('daysAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T15:00:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('returns "today" for the same calendar day', () => {
    expect(daysAgo('5/10/2026')).toBe('today');
  });

  it('returns "yesterday" for 1 day ago', () => {
    expect(daysAgo('5/9/2026')).toBe('yesterday');
  });

  it('returns "N days ago" for 2+ days', () => {
    expect(daysAgo('5/3/2026')).toBe('7 days ago');
  });

  it('returns the raw string when the date is unparseable', () => {
    expect(daysAgo('not a date')).toBe('not a date');
  });
});

describe('formatLastFillupDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T15:00:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('combines absolute date with "today"', () => {
    expect(formatLastFillupDate('5/10/2026')).toBe('May 10, 2026 (today)');
  });

  it('combines absolute date with "yesterday"', () => {
    expect(formatLastFillupDate('5/9/2026')).toBe('May 9, 2026 (yesterday)');
  });

  it('combines absolute date with "N days ago"', () => {
    expect(formatLastFillupDate('5/3/2026')).toBe('May 3, 2026 (7 days ago)');
  });

  it('uses en-US month abbreviations (not browser locale)', () => {
    expect(formatLastFillupDate('1/2/2026')).toBe('Jan 2, 2026 (128 days ago)');
  });

  it('returns the raw string on empty input', () => {
    expect(formatLastFillupDate('')).toBe('');
  });

  it('returns the raw string when not three segments', () => {
    expect(formatLastFillupDate('5/10')).toBe('5/10');
  });

  it('returns the raw string on non-numeric segments', () => {
    expect(formatLastFillupDate('5/foo/2026')).toBe('5/foo/2026');
  });

  it('returns the raw string on unparseable date', () => {
    expect(formatLastFillupDate('not a date')).toBe('not a date');
  });
});
