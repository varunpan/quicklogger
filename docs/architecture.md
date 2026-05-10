# Architecture

This document describes how quicklogger is put together. Each section is filled in alongside the code it describes (per the Documentation policy in the spec).

## Overview

(populated in Task 32)

## Server modules

### Units conversion (`src/lib/server/units.ts`)

Pure conversion helpers between US gallons and liters. The constant
`GAL_TO_L = 3.785411784` is the exact definitional ratio (US gallon, NIST).

Public surface:
- `toGallons(value, unit)` — convert to US gallons. `unit` is `'gal'` or `'L'`.
- `toLiters(value, unit)` — convert to liters. Same units.
- `GAL_TO_L` — the conversion constant, exposed for tests.

Negative inputs throw `RangeError`; unknown units throw `TypeError`.
The module has no external dependencies and is safe to import in
both server and edge runtimes.

### Environment configuration (`src/lib/server/env.ts`)

Single source of truth for env-var access. Other server modules import
`loadEnv()` rather than reading `process.env` directly — this keeps
validation centralized and makes the test surface obvious.

Required: `LUBELOGGER_URL`, `LUBELOGGER_API_KEY`. Missing either at
startup throws `EnvError`, which surfaces as a fast-fail container
crash (visible in Discord via LoggiFly).

Optional with defaults: `LUBELOGGER_VOLUME_UNIT` (`gallons_us`),
`LUBELOGGER_CURRENCY` (`USD`), `FX_PROVIDERS`
(`frankfurter,erapi,fawazahmed`), `FX_CACHE_PATH`
(`/data/fx-cache.json`), `PORT` (`3000`), `ORIGIN` (none).

`FX_PROVIDERS` is a CSV; unknown provider names throw `EnvError`.
`EXCHANGERATE_API_KEY` is only required if `exchangerate-api` is in
the chain.

### FX provider chain (`src/lib/server/currency.ts`)

Multi-provider FX rate resolver with persistent cache.

**Public API:**
- `CurrencyService` — class wrapping the chain logic. Constructor takes
  `{ providers, fetcher, store }` for testability.
- `JsonFileStore` — `FxStore` implementation backed by a JSON file
  (default `/data/fx-cache.json`).
- `realFetcher` — production `FxFetcher` that hits the actual upstream
  providers with a 3s timeout.
- `FxUnavailableError` — thrown when all providers fail and cache is
  empty / older than 7 days.

**Resolution order on `getRate(from, to)`:**
1. Identity short-circuit if `from === to` → returns rate=1, source=`identity`.
2. Disk cache hit (entry < 24h old) → returned with `stale: false`.
3. Provider chain walked in `FX_PROVIDERS` order. First successful
   response wins; cache updated on disk.
4. All providers failed but cache exists and < 7 days old → returned
   with `stale: true`.
5. All providers failed and cache absent / > 7 days → throws
   `FxUnavailableError`. The route handler catches this and signals
   the UI to show the manual-override field.

**Provider implementations:**
| Provider | URL | Notes |
|---|---|---|
| frankfurter | `api.frankfurter.dev/v1/latest?base=...&symbols=...` | ECB, daily |
| erapi | `open.er-api.com/v6/latest/${from}` | Free, no key |
| fawazahmed | `cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${from}.json` | jsDelivr CDN |
| exchangerate-api | `v6.exchangerate-api.com/v6/${KEY}/latest/${from}` | Optional, key required |

All providers use `AbortSignal.timeout(3000)`. Failures are logged
with provider name + reason but never throw out of the chain — the
service either returns a rate, returns a stale rate, or throws once at
the end.

### LubeLogger client (`src/lib/server/lubelogger.ts`)

(populated in Task 8)

### Conversion orchestrator (`src/lib/server/convert.ts`)

Combines `units.ts` and `currency.ts` into a single
`convertSubmission()` call used by the `POST /api/fuelup` route.

Input: raw user submission (`FuelInput`). Output: target-unit gallons +
target-currency cost + FX provenance fields (rate, source, fetchedAt,
stale flag).

Behavior:
- If `manualFxRate` is set on the input, the rate is used verbatim and
  `fxSource` is recorded as `'manual'` — the currency service is not
  consulted.
- Otherwise the currency service resolves the rate per its provider
  chain. Stale rates pass through with `fxStale: true`.
- Volume is always converted via `toGallons`. Target unit other than
  `gallons_us` throws — v0.1.0 only supports US-gallon LubeLogger
  configurations. (Spec parking lot: multi-target-unit support.)

Pure module — all I/O is delegated to the injected `CurrencyService`,
which makes the whole thing trivially testable with a fake.

## Frontend

### State management

The frontend keeps state in three buckets, each with a clear purpose:

- **`localStorage`** (`src/lib/client/prefs.ts`) — user preferences:
  `lastVehicleId`, `defaultVolumeUnit`, `defaultCurrency`. Single
  storage key `quicklogger.prefs` holds a JSON blob. Defaults are
  used when storage is unavailable or content is malformed (private
  browsing, cleared site data).

- **`IndexedDB`** (`src/lib/client/idb.ts`) — offline submission
  queue. See Task 17.

- **Service worker `Cache Storage`** — app shell precache for instant
  launch. See Task 24.

These are intentionally separated: prefs are sync + tiny, the queue
is async + structured, the SW cache is opaque + binary. No state lives
in shared in-memory stores — every page load reads from the
authoritative source.

**`IndexedDB` schema — `pendingSubmissions` store:**

| Field | Type | Notes |
|---|---|---|
| `id` | autoincrement key | |
| `input` | `FuelSubmissionInput` | the unmodified user payload |
| `status` | `'queued' \| 'failed'` | failed = 4xx response, no auto-retry |
| `attempts` | number | incremented per retry, capped at 5 |
| `enqueuedAt` | ms epoch | for stale-entry pruning later |
| `lastError` | string? | populated on failure |

The queue is opened lazily by the service worker and re-used per page
load via `Queue.open()`. Records are inserted on submission failure,
removed on retry success, and marked `failed` on permanent (4xx)
errors. The `/history` page surfaces the failed entries so the user
can decide whether to fix and retry manually.

## Frontend pages

### `/` — main form
The single most-used page. Implements mockup B from the design spec.
Loads vehicle list + last fuelup via `+page.ts`. Reads `URL`
query params for Apple-Shortcut deep-link pre-fill (Path 1 of the
Shortcuts integration). `$effect` block fetches the FX rate when
currency changes; `needsManualFx` toggles the manual-rate field when
the chain is exhausted.

When `data.lastFuelup` is non-null, a two-line **last-fillup strip**
renders above the vehicle picker — `Last fill: {odometer} mi · {days
ago}` on line one, `{volume} Gal · ${cost} · {notes}` on line two.
Format helpers (`formatOdometer`, `daysAgo`) live in
`src/lib/client/format.ts` so the calendar-day arithmetic is
unit-testable. The strip is a snapshot at page-load — submitting a
fillup re-prefills the odometer field from the same snapshot, and the
strip itself only refreshes on the next navigation/page-load.

The strip and odometer prefill survive **upstream outages** via a local-first
resolver (`src/lib/client/last-fillup.ts`). On every successful upstream
fetch, the loader caches the raw `GasRecord` to `localStorage` keyed by
vehicle id. On upstream null/error, it consults the cache plus the
IndexedDB queue (`'queued'` and `'synced'` entries scoped to the vehicle)
and returns the freshest record. `data.lastFuelupSource` is `'upstream'`
when live data was used, `'offline'` when the resolver supplied the value
(strip renders an `offline copy` chip), or `null` when nothing is
available. The queue's `'synced'` status — set by the form's success path
and by the service worker after a successful replay — keeps a permanent
local trail of submissions so the resolver always has something to fall
back on after the first online use.

The **odometer field** opens prefilled with the last reading (raw
digits — `type="number"` can't render thousands separators) when
`prefs.odometerPrefillEnabled` is true and `data.lastFuelup` exists.
A `prefilled` pill marks the field; muted text snaps to white on
first interaction. A blue `+N mi` chip below the field bumps the
current value by `prefs.odometerIncrementMi` on tap (stacks across
multiple taps). After any edit, a helper line shows the delta from
the last reading: `+N mi this tank`. Both prefs come from
`src/lib/client/prefs.ts` and default to `true` / `300`.

Submit logic:
1. Build `FuelSubmissionInput` with a fresh client UUID
2. Try `POST /api/fuelup`
3. On success: success toast + reset volatile fields (odometer
   re-prefills from snapshot) + `savePrefs`
4. On 4xx: rejection toast (don't queue — won't fix itself)
5. On any other failure: enqueue to IndexedDB, show "queued" toast

Submit is gated client-side via a `canSubmit` derived (the button stays
disabled until all four required fields are present with non-zero
numeric values). The same contract is enforced server-side in
`/api/fuelup`'s `validate()` — non-form callers (Shortcuts, direct
curl) get a 400 with the failing field names.

The summary line above the submit button shows live "Will log: X gal /
$Y USD" + MPG-since-last-fill + a stale-FX warning when applicable.

### Service worker (`src/service-worker.ts`)

Three responsibilities:

1. **App-shell precache** — on install, all build assets + static
   files are added to the `quicklogger-shell-${version}` cache. Old
   caches are pruned on activate. The user gets an instant launch on
   subsequent loads.

2. **Network-first for `/api/*`** — API calls are not cached (data
   freshness wins). Failed GETs return a `504` so the page can show
   an inline error rather than a generic browser offline page.

3. **Queue sync on focus** — the layout sends a `sync-queue` message
   to the SW on `window.focus`. The SW iterates `pendingSubmissions`
   in IndexedDB, posts each `queued` entry to `/api/fuelup` (capped
   at 5 attempts), removes successes, marks 4xx as failed.

iOS doesn't fire Background Sync events reliably, so we use the
focus-event pattern as the primary trigger. This means the user
must reopen the app for queued submissions to flush — that's the
realistic UX on iOS Safari today.

## Data flow

(populated in Task 32)
