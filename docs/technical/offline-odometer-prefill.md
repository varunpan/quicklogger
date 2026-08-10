# Offline odometer prefill — internals

## Overview

When `/api/vehicle/last-fuelup` returns `null` or errors (offline, upstream
down), the page-load resolver falls back to local sources so the odometer
still prefills and the last-fillup strip still renders. The resolver picks
the freshest record across two stores: a per-vehicle `localStorage`
snapshot of the most recent successful upstream fetch, and the IndexedDB
queue's `'synced'` and `'queued'` entries.

User guide: [`docs/user/odometer-prefill.md`](../user/odometer-prefill.md).
Where it sits in the bigger picture: see the `/` page section in
[`docs/architecture.md`](../architecture.md#--main-form).

## Storage

### IndexedDB queue (`src/lib/client/idb.ts`)

`QueueStatus` is now `'queued' | 'failed' | 'synced'`:

- `'queued'` — submit failed offline; pending replay (today's semantics).
- `'failed'` — replay attempted, got a 4xx (today's semantics).
- `'synced'` — submission succeeded; kept as local history, pruned per
  vehicle on each queue drain to the `historyKeepPerVehicle` preference
  (default 200; the resolver only reads the newest row). **New.**

Schema is unchanged — `status` is a plain string field, IndexedDB doesn't
validate union values, no DB version bump. Existing `'queued'`/`'failed'`
rows on devices upgrading from prior versions persist exactly. The DB
version stays at `1`.

`Queue.enqueue(input, status?, converted?)` accepts an optional status
(default `'queued'`) so the form's success path can record `'synced'`
directly, plus an optional third `converted: ConvertedSnapshot` argument —
the server-derived `{ cost, currency }` snapshot (see
[`offline-queue.md`](./offline-queue.md) for `ConvertedSnapshot`).
`Queue.markSynced(id: number, converted?: ConvertedSnapshot)` transitions
an existing entry to `'synced'`, optionally attaching that same snapshot;
used by the replay loop after a successful replay POST. `markSynced` is a
no-op when the id doesn't exist (matches `markFailed` semantics).

Two writers create `'synced'` rows:

1. **Form success path** in `+page.svelte` — after `submitFuelup()` returns
   200, the page calls
   `q.enqueue(input, 'synced', { cost: result.submitted.cost, currency: result.submitted.currency })`.
2. **Replay loop** in `sync-queue.ts` — after a queued entry posts
   successfully, `syncQueue()` calls `q.markSynced(entry.id, snapshot)`
   instead of `q.remove(entry.id)`, where `snapshot` is the `{ cost,
currency }` read off the replay response body (see the _Service
   worker_ section below). The entry stays in the queue as a synced
   record.

## Resolver (`src/lib/client/last-fillup.ts`)

`resolveOfflineLastFillup(vehicleId, queue?)` returns a `LastFillupRecord`
or `null`. It reads the localStorage snapshot for the vehicle (key
`quicklogger.lastFuelup.<vehicleId>`) **and** the IndexedDB queue, scopes
queue entries to the requested vehicle, drops `'failed'` entries, normalizes
each candidate, and returns the one with the newest day. Ties on date go to
the most recently enqueued entry (the cache's tiebreak is `0`, so a queue
entry on the same day always wins — a fresh local submission is the source
of truth over a possibly-stale snapshot).

The optional `queue` parameter exists for tests; production callers omit it
and the resolver opens the default-named queue.

### `LastFillupRecord` vs upstream `GasRecord`

The output shape mirrors `GasRecord` so the page-side render path
(`formatOdometer`, `daysAgo`, the strip template) works unchanged. The
**only** addition is `costCurrency: string | null`:

- `null` for upstream-cached records — server has FX-normalized `cost` to
  whatever LubeLogger uses. At render time `formatCost`
  (`src/lib/client/format.ts`) falls back to `effectiveCurrencyCode()` —
  the cached instance currency — and formats via `Intl.NumberFormat` in
  the instance locale (a `$` only when the instance currency is USD).
- The entered currency (e.g. `'CAD'`) for queue-derived records — we don't
  run FX offline. `formatCost` renders the cost in that entered currency
  (e.g. `CA$60.00`) so the user isn't misled into thinking the value has
  been converted.

### Normalization

| Field          | Upstream cache                                                                                             | Queue entry                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `date`         | passes through (already ISO `YYYY-MM-DD`; legacy locale-format snapshots are migrated on read — see below) | passes through (already ISO `YYYY-MM-DD`)                                                  |
| `odometer`     | passes through (string, instance distance unit)                                                            | `String(Math.round(input.odometer))`                                                       |
| `fuelConsumed` | passes through — already instance-unit (`TARGET_UNIT_LABEL` renders it on the strip)                       | converted into the **instance** volume unit via `toLiters`/`toGallons`, then `.toFixed(2)` |
| `cost`         | `String(cost)` or `null`                                                                                   | `input.cost.toFixed(2)`                                                                    |
| `costCurrency` | always `null`                                                                                              | `input.currency`                                                                           |
| `notes`        | `String(notes)` or `null`                                                                                  | `input.notes ?? null`                                                                      |

The `fuelConsumed` conversion is instance-driven, not a hardcoded gallons
divisor: `readQueueCandidates()` (`src/lib/client/last-fillup.ts`) hoists
`const instanceUnit = effectiveVolumeUnit();` once per resolve, then per
entry converts the user-entered volume into that instance unit —
`toLiters(entry.input.volume, entry.input.volumeUnit)` on a liters
instance, `toGallons(...)` otherwise. On a liters instance, an entry
already entered in `'L'` isn't divided by anything; the old bare
`/ 3.785411784` gallons arithmetic no longer exists anywhere in this path.
`toLiters`/`toGallons` can throw (`RangeError` on a negative volume,
`TypeError` on an unrecognized unit) — the per-entry loop catches that and
`continue`s past the entry rather than letting it sink the whole resolve;
a corrupt queue entry is dropped, not fatal.

### Legacy-date migration

Cached snapshots written before the typed-ISO change carry `date` in the
LubeLogger instance's display locale, not ISO. The cache read is tolerant:
an ISO-shaped date takes the fast path; anything else goes through
`parseLegacyDate` (`last-fillup.ts`), which supports the four LubeLogger
`dateFormat` patterns observed in the wild — `M/d/yyyy` (en-US),
`d/M/yyyy` (en-GB), `yyyy-MM-dd` (ISO), and `d.M.yyyy` (de-DE). The parser
depends on the cached server-info `dateFormat` (`loadServerInfo()`) to
disambiguate day vs month; a missing `dateFormat` or an unknown pattern
makes the snapshot a cache miss — the next successful upstream fetch
repopulates the cache in the new ISO shape.

### Storage failure modes

`localStorage` reads are wrapped in `try/catch`. Quota exhaustion and
parse failures both degrade silently — the cache contributes no candidate
and the resolver falls back to the queue (or returns `null` if the queue
is also empty). IndexedDB read failures are wrapped the same way; the
resolver returns whatever it can from the other source.

## Loader (`src/routes/+page.ts`)

The loader is universal (runs on the server during SSR, in the browser
during client navigation / PWA refresh). The cache write and the resolver
call are gated on `import { browser } from '$app/environment'` because
neither `localStorage` nor IndexedDB exist server-side.

Flow:

1. Fetch the vehicle list and pick the target vehicle (existing logic,
   unchanged).
2. `lastFuelup(targetVehicle.id)` — same call as before, returns
   `GasRecord | null`.
3. If upstream returned a record:
   - Normalize to `LastFillupRecord` (`costCurrency: null`).
   - In the browser, persist only the five fields the resolver reads
     (`date`, `odometer`, `fuelConsumed`, `cost`, `notes`) into
     `localStorage.quicklogger.lastFuelup.<vehicleId>` — the full
     `GasRecord` includes `extraFields` / `files`, which can be arbitrarily
     large and would risk localStorage quota. Failures (quota, disabled
     storage) are swallowed.
   - Set `lastFuelupSource = 'upstream'`.
4. If upstream returned null:
   - In the browser, call `resolveOfflineLastFillup(vehicleId)`. If it
     returns a record, set `lastFuelupSource = 'offline'`. Otherwise
     `lastFuelupSource = null`.
   - Server-side path is unreachable in practice (the PWA almost always
     serves the page from the SW-cached HTML), but it returns
     `lastFuelupSource = null` for completeness.
5. Return `{ ..., lastFuelup, lastFuelupSource }`.

The loader normalizes the upstream `GasRecord` to `LastFillupRecord` so the
page consumes a single shape regardless of source. `data.lastFuelup` is
typed as `LastFillupRecord | null`.

## Page (`src/routes/+page.svelte`)

Two changes:

1. **Strip rendering** — when `data.lastFuelupSource === 'offline'`, an
   amber-tinted `offline copy` chip appears next to the days-ago text. The
   second line always calls
   `formatCost(Number(data.lastFuelup.cost), data.lastFuelup.costCurrency)` —
   there's no separate branch for the offline case. `formatCost` itself
   does the currency selection (`currencyCode ?? effectiveCurrencyCode()`),
   so a queue-derived record's entered `costCurrency` naturally wins over
   the cached instance currency, and an upstream-cached record's `null`
   falls back to it — see _`LastFillupRecord` vs upstream `GasRecord`_
   above for why that avoids implying an FX conversion happened.
2. **Submit success path** — after `submitFuelup` returns 200 and prefs are
   saved, the input is appended to the queue with `status: 'synced'`. This
   is fire-and-forget; IDB failures are swallowed and don't affect the
   submit toast. The form is reset _before_ the navigation to the vehicle's
   maintenance view (so the writes land on the still-mounted component), and
   the success toast set above stays visible through the maintenance load.
   On the next page navigation / PWA relaunch, the resolver has this row
   available as a fallback when upstream is unreachable.

## Service worker (`src/service-worker.ts`) / replay loop (`src/lib/client/sync-queue.ts`)

The replay loop itself lives in `syncQueue()` in `sync-queue.ts`, not in
`service-worker.ts` — it was extracted so it's unit-testable independent
of the SW runtime. `service-worker.ts` only imports `syncQueue` and
invokes it from its `message` handler
(`event.waitUntil(syncQueue(undefined, data.historyKeepPerVehicle))`); see
[`offline-queue.md`](./offline-queue.md) for the full trigger/message
plumbing.

The replay loop's success branch was `q.remove(entry.id)`. It is now
`q.markSynced(entry.id, snapshot)` — note the second argument: `snapshot`
is the `ConvertedSnapshot` (`{ cost, currency }`) parsed from the replay
response body, so a replayed submission's converted cost survives into
the synced row exactly like the form's own success-path `enqueue` call
above. Net behaviour difference for an upgraded device: in-flight
`'queued'` rows that previously _disappeared_ on successful replay now
become `'synced'` rows. Growth is bounded: `syncQueue()` ends every drain
with `Queue.pruneSynced(keep)` (`sync-queue.ts` / `idb.ts`), deleting all
but the newest `historyKeepPerVehicle` (default 200) `'synced'` rows per
vehicle — see the Storage section above.
