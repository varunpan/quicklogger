import { loadServerInfo } from '$lib/client/server-info';

// --- Locale / currency resolution ---
//
// Both helpers SSR-safe by inheritance — loadServerInfo() returns null when
// localStorage is undefined. Fallback is en-US / USD: the en-US/USD user
// (current primary) sees byte-identical output; other locales degrade
// gracefully until the layout's boot refresh populates the cache.

function effectiveLocale(): string {
  return loadServerInfo()?.locale ?? 'en-US';
}

function effectiveCurrencyCode(): string {
  return loadServerInfo()?.lubeloggerCurrency ?? 'USD';
}

// --- Number formatting ---

export function formatOdometer(s: string): string {
  if (!s) return s;
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return new Intl.NumberFormat(effectiveLocale()).format(Math.round(n));
}

// --- Date formatting (ISO YYYY-MM-DD only) ---

// Returns relative phrase using local-calendar day arithmetic.
export function daysAgo(s: string): string {
  if (!s) return s;
  const parts = s.split('-');
  if (parts.length !== 3) return s;
  const [y, m, d] = parts.map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return s;
  const then = new Date(y, m - 1, d);
  if (Number.isNaN(then.getTime())) return s;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((todayStart.getTime() - then.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  return `${diffDays} days ago`;
}

// `Mon D, YYYY (N days ago)` for the home strip. Locale-driven absolute date.
export function formatLastFillupDate(s: string): string {
  if (!s) return s;
  const parts = s.split('-');
  if (parts.length !== 3) return s;
  const [y, m, d] = parts.map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return s;
  const then = new Date(y, m - 1, d);
  if (Number.isNaN(then.getTime())) return s;
  const abs = then.toLocaleDateString(effectiveLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
  return `${abs} (${daysAgo(s)})`;
}

// Renders LubeLogger's pre-computed countdown (dueDays / dueDistance) as
// natural-language phrases. Accepts number | string for caller flexibility —
// dueDays is now typed `number`, but callers may still pass through string
// inputs from other sources.
export function humanCountdown(value: number | string, unit: 'days' | 'mi'): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '';
  if (n === 0) return unit === 'days' ? 'due today' : 'due now';
  const abs = Math.abs(n);
  const formatted =
    unit === 'mi' ? new Intl.NumberFormat(effectiveLocale()).format(abs) : String(abs);
  return n > 0 ? `${formatted} ${unit} to go` : `${formatted} ${unit} overdue`;
}

// `Mon D, YYYY` for maintenance reminders.
export function formatDueDate(s: string): string {
  if (!s) return s;
  const parts = s.split('-');
  if (parts.length !== 3) return s;
  const [y, m, d] = parts.map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return s;
  const then = new Date(y, m - 1, d);
  if (Number.isNaN(then.getTime())) return s;
  return then.toLocaleDateString(effectiveLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
}

// `Mon D, YYYY · N days ago` for /history cards.
export function formatIsoDate(s: string): string {
  if (!s) return s;
  const parts = s.split('-');
  if (parts.length !== 3) return s;
  const [y, m, d] = parts.map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return s;
  const then = new Date(y, m - 1, d);
  if (Number.isNaN(then.getTime())) return s;
  const abs = then.toLocaleDateString(effectiveLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
  return `${abs} · ${daysAgo(s)}`;
}

// --- Currency ---

// Renders a numeric cost in the entry's currency, locale-correctly.
// Upstream-cached entries (LastFillupRecord.costCurrency = null) fall back
// to the LubeLogger instance currency (effectiveCurrencyCode()).
export function formatCost(cost: number, currencyCode: string | null): string {
  if (!Number.isFinite(cost)) return '';
  const code = currencyCode ?? effectiveCurrencyCode();
  return new Intl.NumberFormat(effectiveLocale(), {
    style: 'currency',
    currency: code
  }).format(cost);
}
