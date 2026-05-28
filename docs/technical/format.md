# `format.ts` — locale-driven rendering

## Overview

All client-side rendering of dates, numbers, and currency goes through
[`src/lib/client/format.ts`](../../src/lib/client/format.ts). Every helper
resolves locale from the cached `/api/server-info` (`locale` field) and
currency from the cached `lubeloggerCurrency`. Both have hardcoded fallbacks
(`en-US` / `USD`) when the cache is empty or SSR has no `localStorage`.

User guide: not applicable — formatting is invisible-by-design when
LubeLogger's locale matches the browser's. Locale source-of-truth:
[`docs/technical/server-info.md`](./server-info.md).

## Helpers

| Helper | Input | Output shape | Locale source |
| --- | --- | --- | --- |
| `formatOdometer(s)` | string (digits) | locale thousands sep | `effectiveLocale()` |
| `daysAgo(iso)` | ISO date | `today` / `yesterday` / `N days ago` | local calendar (no locale) |
| `formatLastFillupDate(iso)` | ISO date | `Mon D, YYYY (relative)` | `effectiveLocale()` |
| `humanCountdown(n, 'days' \| 'mi')` | number \| string | `N units to go` / `N units overdue` | `effectiveLocale()` (mi only) |
| `formatDueDate(iso)` | ISO date | `Mon D, YYYY` | `effectiveLocale()` |
| `formatIsoDate(iso)` | ISO date | `Mon D, YYYY · relative` | `effectiveLocale()` |
| `formatCost(n, code \| null)` | number, ISO 4217 code or null | locale-currency format | `effectiveLocale()` + (code ?? `effectiveCurrencyCode()`) |

## Resolution rules

- `effectiveLocale()` — `loadServerInfo()?.locale` ?? `'en-US'`.
- `effectiveCurrencyCode()` — `loadServerInfo()?.lubeloggerCurrency` ?? `'USD'`.
- `loadServerInfo()` returns `null` when `localStorage` is undefined (SSR)
  or when the cache is empty/malformed — both fall through to the hardcoded
  fallback.

## SSR / hydration

On SSR `effectiveLocale()` always returns `'en-US'` (no `localStorage`).
Client hydration may read a non-en-US cached value, producing a brief flash.
For the en-US/USD user the flash is invisible. For non-en-US users this is
an accepted trade-off — no mitigation in this branch.

## `formatCost` semantics

- `formatCost(cost, 'CAD')` — entered currency (queue entries). Renders
  in the entry's currency in the active locale.
- `formatCost(cost, null)` — upstream-cached entries; falls back to
  `effectiveCurrencyCode()` (the LubeLogger instance currency). Upstream
  rows are FX-normalized server-side, so the instance currency is right.
- `formatCost(NaN, ...)` returns the empty string so callers can render
  nothing without checking finiteness upstream.

## Edge cases & invariants

- **All date funcs fall back to the raw input on parse failure.** UI never
  renders "Invalid Date".
- **`humanCountdown(0, 'days')` → `'due today'`; `(0, 'mi')` → `'due now'`.**
- **Locale lookup is per-call, not memoized.** A boot-refresh between two
  renders surfaces immediately; no cache to invalidate.
- **`Intl.NumberFormat` output is locale-sensitive.** Test assertions for
  non-en-US locales should compare against `Intl.NumberFormat(...).format(...)`
  directly, not hardcoded literal strings (e.g. de-DE uses non-breaking
  space as thousands separator in some cases).
