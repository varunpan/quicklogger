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
