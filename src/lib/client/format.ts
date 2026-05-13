// LubeLogger returns odometer as a string; parse, round to whole miles,
// and format with thousands separators. Falls back to the raw input on
// parse failure so we never render "NaN" in the UI.
export function formatOdometer(s: string): string {
  if (!s) return s;
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

// LubeLogger returns dates as `M/D/YYYY` (US locale). Compare against
// the local calendar day, not UTC, so "today" matches the user's clock.
export function daysAgo(s: string): string {
  if (!s) return s;
  const parts = s.split('/');
  if (parts.length !== 3) return s;
  const [m, d, y] = parts.map(Number);
  if (!Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(y)) return s;
  const then = new Date(y, m - 1, d);
  if (Number.isNaN(then.getTime())) return s;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((todayStart.getTime() - then.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  return `${diffDays} days ago`;
}

// LubeLogger returns dates as `M/D/YYYY`. Renders the date for the
// last-fillup info strip as `Mon D, YYYY (N days ago)`. Falls back to
// the raw input on parse failure so the UI never shows "Invalid Date".
// Locale pinned to en-US so the rendered month order is deterministic
// across devices (browser default would swap to D Mon in en-GB).
export function formatLastFillupDate(s: string): string {
  if (!s) return s;
  const parts = s.split('/');
  if (parts.length !== 3) return s;
  const [m, d, y] = parts.map(Number);
  if (!Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(y)) return s;
  const then = new Date(y, m - 1, d);
  if (Number.isNaN(then.getTime())) return s;
  const abs = then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${abs} (${daysAgo(s)})`;
}

// Renders LubeLogger's pre-computed countdown values (`dueDays`,
// `dueDistance`) as natural-language phrases. Positive = remaining,
// negative = overdue, zero = "due today" / "due now". Non-finite or
// unparseable input returns the empty string so the caller can render
// nothing rather than "NaN ... to go".
export function humanCountdown(value: number | string, unit: 'days' | 'mi'): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '';
  if (n === 0) return unit === 'days' ? 'due today' : 'due now';
  const abs = Math.abs(n);
  const formatted =
    unit === 'mi' ? new Intl.NumberFormat('en-US').format(abs) : String(abs);
  return n > 0 ? `${formatted} ${unit} to go` : `${formatted} ${unit} overdue`;
}

// Formats a LubeLogger M/D/YYYY date as `Mon D, YYYY`. Distinct from
// `formatLastFillupDate` which appends `(N days ago)`; for reminders
// that suffix is supplied separately by `humanCountdown` and would
// double up. Falls back to the raw input on parse failure.
export function formatDueDate(s: string): string {
  if (!s) return s;
  const parts = s.split('/');
  if (parts.length !== 3) return s;
  const [m, d, y] = parts.map(Number);
  if (!Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(y)) return s;
  const then = new Date(y, m - 1, d);
  if (Number.isNaN(then.getTime())) return s;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Formats an ISO `YYYY-MM-DD` date (the shape IDB stores) as
// `Mon D, YYYY · N days ago` for /history cards. Uses the existing
// `daysAgo` helper for the relative suffix — IDB's ISO format is
// converted to `M/D/YYYY` first so the two share one definition of
// "today" / "yesterday" / "N days ago". Locale pinned to en-US to
// match `formatLastFillupDate`. Falls back to the raw input on parse
// failure so the UI never renders "Invalid Date".
export function formatIsoDate(s: string): string {
  if (!s) return s;
  const parts = s.split('-');
  if (parts.length !== 3) return s;
  const [y, m, d] = parts.map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return s;
  const then = new Date(y, m - 1, d);
  if (Number.isNaN(then.getTime())) return s;
  const abs = then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${abs} · ${daysAgo(`${m}/${d}/${y}`)}`;
}
