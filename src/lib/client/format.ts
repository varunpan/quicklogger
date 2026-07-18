import { loadServerInfo } from '$lib/client/server-info';
import type { VolumeUnit, DistanceUnit } from '$lib/shared/units';

// --- Locale / currency resolution ---
//
// Both helpers SSR-safe by inheritance — loadServerInfo() returns null when
// localStorage is undefined. Fallback is en-US / USD: the en-US/USD user
// (current primary) sees byte-identical output; other locales degrade
// gracefully until the layout's boot refresh populates the cache.

function effectiveLocale(): string {
  return loadServerInfo()?.locale ?? 'en-US';
}

export function effectiveCurrencyCode(): string {
  return loadServerInfo()?.lubeloggerCurrency ?? 'USD';
}

// Instance units for volume/distance labels. gal/mi fallback covers SSR,
// cold cache, and pre-v0.3.2 cached copies missing the fields — corrected
// by the layout's boot refresh, exactly like effectiveCurrencyCode().
export function effectiveVolumeUnit(): VolumeUnit {
  return loadServerInfo()?.lubeloggerVolumeUnit === 'liters' ? 'L' : 'gal';
}

export function effectiveDistanceUnit(): DistanceUnit {
  return loadServerInfo()?.lubeloggerDistanceUnit === 'km' ? 'km' : 'mi';
}

// --- Vehicle label ---

// `2019 Honda Civic Si` — shared display label for a vehicle row/card.
// Structural type (not the Vehicle interface) so format.ts stays free of
// $lib/server imports.
export function vehicleLabel(
  v: { year?: number; make?: string; model?: string } | null | undefined
): string {
  if (!v) return '';
  return [v.year, v.make, v.model].filter(Boolean).join(' ');
}

// --- Number formatting ---

export function formatOdometer(s: string): string {
  if (!s) return s;
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return new Intl.NumberFormat(effectiveLocale()).format(Math.round(n));
}

// --- Date formatting (ISO YYYY-MM-DD only) ---

/** Parse a strict `YYYY-MM-DD` string to a local-midnight Date, or null on
 *  anything else (empty, wrong segment count, non-numeric parts). The shared
 *  preamble of every date formatter below — callers fall back to the raw
 *  input on null so UI never renders "Invalid Date". */
export function parseIsoLocal(s: string): Date | null {
  if (!s) return null;
  const parts = s.split('-');
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const then = new Date(y, m - 1, d);
  return Number.isNaN(then.getTime()) ? null : then;
}

// Returns relative phrase using local-calendar day arithmetic.
export function daysAgo(s: string): string {
  const then = parseIsoLocal(s);
  if (!then) return s;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((todayStart.getTime() - then.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  return `${diffDays} days ago`;
}

// `Mon D, YYYY (N days ago)` for the home strip. Locale-driven absolute date.
export function formatLastFillupDate(s: string): string {
  const then = parseIsoLocal(s);
  if (!then) return s;
  const abs = then.toLocaleDateString(effectiveLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  return `${abs} (${daysAgo(s)})`;
}

// Renders LubeLogger's pre-computed countdown (dueDays / dueDistance) as
// natural-language phrases. Accepts number | string for caller flexibility —
// dueDays is now typed `number`, but callers may still pass through string
// inputs from other sources.
export function humanCountdown(value: number | string, unit: 'days' | 'mi' | 'km'): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '';
  if (n === 0) return unit === 'days' ? 'due today' : 'due now';
  const abs = Math.abs(n);
  const formatted =
    unit === 'days' ? String(abs) : new Intl.NumberFormat(effectiveLocale()).format(abs);
  return n > 0 ? `${formatted} ${unit} to go` : `${formatted} ${unit} overdue`;
}

// `Mon D, YYYY` for maintenance reminders.
export function formatDueDate(s: string): string {
  const then = parseIsoLocal(s);
  if (!then) return s;
  return then.toLocaleDateString(effectiveLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

// `Mon D, YYYY · N days ago` for /history cards.
export function formatIsoDate(s: string): string {
  const then = parseIsoLocal(s);
  if (!then) return s;
  const abs = then.toLocaleDateString(effectiveLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
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
