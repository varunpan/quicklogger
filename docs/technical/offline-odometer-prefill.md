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
- `'synced'` — submission succeeded; kept as permanent local history. **New.**

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

(More sections appended in subsequent commits.)

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
