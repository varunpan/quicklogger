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
