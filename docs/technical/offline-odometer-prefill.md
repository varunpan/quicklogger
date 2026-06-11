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
[`docs/architecture.md`](../architecture.md#---main-form).

## Storage

### IndexedDB queue (`src/lib/client/idb.ts`)

`QueueStatus` is now `'queued' | 'failed' | 'synced'`:

- `'queued'` — submit failed offline; pending replay (today's semantics).
- `'failed'` — replay attempted, got a 4xx (today's semantics).
- `'synced'` — submission succeeded; kept as local history, pruned to the
  newest 5 per vehicle on each queue drain (the resolver only reads the
  newest row). **New.**

Schema is unchanged — `status` is a plain string field, IndexedDB doesn't
validate union values, no DB version bump. Existing `'queued'`/`'failed'`
rows on devices upgrading from prior versions persist exactly. The DB
version stays at `1`.

`Queue.enqueue(input, status?)` accepts an optional status (default
`'queued'`) so the form's success path can record `'synced'` directly.
`Queue.markSynced(id)` transitions an existing entry to `'synced'`; used by
the service worker after a successful replay POST. `markSynced` is a
no-op when the id doesn't exist (matches `markFailed` semantics).

Two writers create `'synced'` rows:

1. **Form success path** in `+page.svelte` — after `submitFuelup()` returns
   200, the page calls `q.enqueue(input, 'synced')`.
2. **Service worker replay** in `service-worker.ts` — after a queued entry
   posts successfully, the worker calls `q.markSynced(entry.id)` instead of
   `q.remove(entry.id)`. The entry stays in the queue as a synced record.

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
  whatever LubeLogger uses (typically USD), so the page renders `$<cost>`.
- The entered currency (e.g. `'CAD'`) for queue-derived records — we don't
  run FX offline. The page renders `<currency> <cost>` (e.g. `CAD 60.00`)
  so the user isn't misled into thinking the value has been converted.

### Normalization

| Field | Upstream cache | Queue entry |
|---|---|---|
| `date` | passes through (already `M/D/YYYY`) | converted from ISO `YYYY-MM-DD` to `M/D/YYYY` |
| `odometer` | passes through (string) | `String(Math.round(input.odometer))` |
| `fuelConsumed` | passes through (gallons string) | `(volume / 3.785411784).toFixed(2)` if `volumeUnit === 'L'`, else `volume.toFixed(2)` |
| `cost` | `String(cost)` or `null` | `input.cost.toFixed(2)` |
| `costCurrency` | always `null` | `input.currency` |
| `notes` | `String(notes)` or `null` | `input.notes ?? null` |

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
   - In the browser, persist the *raw* upstream JSON into
     `localStorage.quicklogger.lastFuelup.<vehicleId>` — that's what the
     resolver expects to read back. Failures (quota, disabled storage)
     are swallowed.
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
   second line picks `<currency> <cost>` (when `costCurrency` is non-null)
   over the historical `$<cost>` to avoid implying FX conversion happened.
2. **Submit success path** — after `submitFuelup` returns 200 and prefs are
   saved, the input is appended to the queue with `status: 'synced'`. This
   is fire-and-forget; IDB failures are swallowed and don't affect the
   submit toast. The form is reset *before* the navigation to the vehicle's
   maintenance view (so the writes land on the still-mounted component), and
   the success toast set above stays visible through the maintenance load.
   On the next page navigation / PWA relaunch, the resolver has this row
   available as a fallback when upstream is unreachable.

## Service worker (`src/service-worker.ts`)

The replay loop's success branch was `q.remove(entry.id)`. It is now
`q.markSynced(entry.id)`. Net behaviour difference for an upgraded device:
in-flight `'queued'` rows that previously *disappeared* on successful
replay now become `'synced'` rows. Disk usage grows by one row per
successful replay (a fillup is ~200 bytes; at 50 fillups/year, ~10 KB/year
worst case). Pruning is out of scope for v1.
