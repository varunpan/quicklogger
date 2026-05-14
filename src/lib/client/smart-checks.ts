import type { Prefs } from './prefs';

// Threshold for the "too high" odometer jump in check E and the OCR-side
// relative-range warning in the main form. Single source of truth; both
// call sites import from here.
export const ODOMETER_MAX_DELTA_MI = 2000;

export type SmartCheckCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'G';

export interface SmartCheckIssue {
  code: SmartCheckCode;
  message: string;
}

export interface SubmissionForCheck {
  odometer: number;
  volume: number;
  volumeUnit: 'gal' | 'L';
  date: string; // ISO YYYY-MM-DD
}

export interface LastFuelupForCheck {
  odometer: number;
  date: string; // ISO YYYY-MM-DD
}

// `en-CA` returns YYYY-MM-DD which compares lex-correctly against the
// submission.date string. Test override via `now` keeps check D
// deterministic across CI time zones.
function getToday(now?: Date): string {
  const d = now ?? new Date();
  return d.toLocaleDateString('en-CA');
}

function formatOdo(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

// "2026-05-07" -> "May 7". Parsed via UTC to avoid local-tz off-by-one when
// midnight rolls between time zones.
function formatShortDate(iso: string): string {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return iso;
  const [y, m, d] = parts;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

function checkA(
  s: SubmissionForCheck,
  last: LastFuelupForCheck
): SmartCheckIssue | null {
  if (s.date >= last.date && s.odometer < last.odometer) {
    return {
      code: 'A',
      message: `Odometer (${formatOdo(s.odometer)} mi) is lower than the last fillup (${formatOdo(last.odometer)} mi on ${formatShortDate(last.date)}).`
    };
  }
  return null;
}

function checkB(
  s: SubmissionForCheck,
  last: LastFuelupForCheck
): SmartCheckIssue | null {
  if (s.date < last.date && s.odometer > last.odometer) {
    return {
      code: 'B',
      message: `Older date but higher odometer than the most recent fillup (${formatOdo(last.odometer)} mi on ${formatShortDate(last.date)}).`
    };
  }
  return null;
}

function checkC(
  s: SubmissionForCheck,
  last: LastFuelupForCheck
): SmartCheckIssue | null {
  if (s.date === last.date && Math.abs(s.odometer - last.odometer) <= 5) {
    return {
      code: 'C',
      message: `Looks like a duplicate of the ${formatShortDate(last.date)} fillup at ${formatOdo(last.odometer)} mi.`
    };
  }
  return null;
}

function checkD(s: SubmissionForCheck, today: string): SmartCheckIssue | null {
  if (s.date > today) {
    return { code: 'D', message: 'Date is in the future.' };
  }
  return null;
}

function checkE(
  s: SubmissionForCheck,
  last: LastFuelupForCheck
): SmartCheckIssue | null {
  const delta = s.odometer - last.odometer;
  if (delta > ODOMETER_MAX_DELTA_MI) {
    return {
      code: 'E',
      message: `Odometer is ${formatOdo(delta)} mi above the last fillup — over 2,000 mi.`
    };
  }
  return null;
}

// Spec: "shift the decimal one place" (0.5 -> 5). Only suggest when the
// original number has a leading zero before the decimal — i.e. value < 1.
// 1.99 L → omit the "did you mean" clause.
function checkG(s: SubmissionForCheck): SmartCheckIssue | null {
  const floor = s.volumeUnit === 'gal' ? 0.5 : 2;
  if (s.volume < floor) {
    const base = `Volume (${s.volume}) seems small`;
    if (s.volume < 1) {
      const suggestion = Number((s.volume * 10).toPrecision(12));
      return { code: 'G', message: `${base} — did you mean ${suggestion}?` };
    }
    return { code: 'G', message: `${base}.` };
  }
  return null;
}

export function evaluateSmartChecks(
  submission: SubmissionForCheck,
  lastFuelup: LastFuelupForCheck | null,
  prefs: Pick<Prefs, 'smartChecksEnabled'>,
  now?: Date
): { issues: SmartCheckIssue[] } {
  if (!prefs.smartChecksEnabled) return { issues: [] };

  const issues: SmartCheckIssue[] = [];
  const today = getToday(now);

  if (lastFuelup) {
    const a = checkA(submission, lastFuelup);
    if (a) issues.push(a);
    const b = checkB(submission, lastFuelup);
    if (b) issues.push(b);
    const c = checkC(submission, lastFuelup);
    if (c) issues.push(c);
  }
  const d = checkD(submission, today);
  if (d) issues.push(d);
  if (lastFuelup) {
    const e = checkE(submission, lastFuelup);
    if (e) issues.push(e);
  }
  const g = checkG(submission);
  if (g) issues.push(g);

  return { issues };
}
