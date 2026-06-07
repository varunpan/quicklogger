# Offline submission queue — internals

## Overview

Submissions that can't reach LubeLogger live in an IndexedDB-backed queue.
The queue is also the local-history substrate that powers offline odometer
prefill (synced rows are kept as a permanent trail). The service worker
replays queued entries on demand, triggered by a message from the layout
when the window regains focus or first mounts.

User-facing view: [`docs/user/offline-queue.md`](../user/offline-queue.md).
Synced-row semantics (v0.1.3 addition):
[`docs/technical/offline-odometer-prefill.md`](./offline-odometer-prefill.md).

## IndexedDB store schema

Source: `src/lib/client/idb.ts`.

| Property | Value |
|---|---|
| Database name | `quicklogger` (default; `Queue.open(name)` accepts an override for tests) |
| Database version | `1` |
| Object store | `pendingSubmissions` |
| `keyPath` | `id` |
| `autoIncrement` | `true` |
| Indexes | `byStatus` on the `status` field |

### Row shape (`QueueEntry`)

| Field | Type | Notes |
|---|---|---|
| `id` | `number` | Auto-assigned by IndexedDB on insert. |
| `input` | `FuelSubmissionInput` | The unmodified user payload (see `src/lib/shared/types.ts`). |
| `status` | `'queued' \| 'failed' \| 'synced'` | See state machine below. |
| `attempts` | `number` | Incremented per replay attempt. Hard cap of `5`. |
| `enqueuedAt` | `number` (ms epoch) | Set by `enqueue()` via `Date.now()`. |
| `lastError` | `string` (optional) | Populated by `markFailed` with the response status. |

The `QueueStatus` union is exported from `idb.ts`:

```ts
export type QueueStatus = 'queued' | 'failed' | 'synced';
```

IndexedDB doesn't validate union values — `status` is stored as a plain
string. This matters for upgrades: see [Schema versioning](#schema-versioning).

## Status state machine

```
        enqueue(input)                       enqueue(input, 'synced')
        (default status)                     (form success path,
              │                               +page.svelte submit())
              ▼                                       │
        ┌──────────┐    SW replay 2xx              ┌─────────┐
        │ 'queued' │ ──────────────────────────►   │'synced' │  (terminal)
        └──────────┘                               └─────────┘
              │
              │  SW replay 4xx
              ▼
        ┌──────────┐
        │ 'failed' │  (terminal; no auto-retry)
        └──────────┘
```

Transitions, with code refs:

- `'queued'` → `'synced'` via `Queue.markSynced(id)` after a successful
  POST in `syncQueue()` (`src/service-worker.ts`).
- `'queued'` → `'failed'` via `Queue.markFailed(id, error)` when the SW
  replay sees a 4xx (`res.status >= 400 && res.status < 500` in
  `src/service-worker.ts`).
- `'synced'` rows are also written directly by the form's success path —
  `+page.svelte`'s `submit()` calls `q.enqueue(input, 'synced')` after a
  200 response from `/api/fuelup`. Those rows never pass through `'queued'`.
- `'failed'` is terminal. The History page (`src/routes/history/+page.svelte`)
  surfaces failed entries for visibility, but there is no built-in
  retry button — the user has to act manually (or wait for the next
  release that adds one).
- `'synced'` is terminal. Synced rows accumulate as permanent local
  history; pruning is out of scope for v0.1.3 (see "Edge cases" below).

5xx responses leave the entry in `'queued'` for the next sync — no
transition. Network errors during replay (the `catch` in `syncQueue`)
do the same.

## Replay path

The replay loop lives in `syncQueue()` in `src/lib/client/sync-queue.ts` —
extracted from the service worker so it's unit-testable (it depends only on
`Queue` + `fetch`). `src/service-worker.ts` imports it and invokes it from the
`message` handler.

### Trigger

The replay is **message-driven**, not Background-Sync-driven. There is
no `sync` event listener and no `sync.register()` call anywhere in the
codebase (verified in `src/service-worker.ts`). Instead:

- `src/routes/+layout.svelte` registers the service worker `onMount` and
  posts a `{ type: 'sync-queue' }` message in three situations:
  1. Immediately, on mount (every page load / PWA cold start).
  2. On every `window` `focus` event.
  3. On `document` `visibilitychange` when the page becomes visible —
     belt-and-suspenders for desktop/Android multi-window where a tab can
     become visible without firing `focus`.

The SW's `message` handler matches `data.type === 'sync-queue'` and
calls `event.waitUntil(syncQueue())`.

There is no Background Sync (`sync`) listener — iOS doesn't fire those
events reliably, so the focus/visibility pattern is the primary trigger.
Users generally have to reopen or refocus the app for queued submissions
to flush. Because `focus` and `visibilitychange` can fire back-to-back on
the same resume, `syncQueue()` carries an in-flight guard (below) so the
double-trigger can't drain the queue twice at once.

### In-flight guard

`syncQueue()` holds a module-level `syncing` flag: if a drain is already
running, a second concurrent call returns immediately. There's exactly one
service-worker instance, so this single flag is a sufficient lock. It's what
stops the `focus` + `visibilitychange` double-trigger from launching two
overlapping drains that each read the same `'queued'` row (neither has marked
it synced yet) and POST it twice. The server-side `clientSubmissionId`
idempotency window is the backstop for any duplicate that still slips through
(e.g. a queue replay racing a foreground submit) — see
[`docs/architecture.md`](../architecture.md#data-flow).

### Per-entry loop

For every entry returned by `Queue.list()`:

1. **Skip** if `entry.status !== 'queued'`. (Synced and failed rows are
   ignored.)
2. **Skip** if `entry.attempts >= 5`. The attempt cap is a hard 5 and
   isn't user-configurable.
3. `Queue.incrementAttempts(id)` is called **before** the fetch — the
   attempt counter advances even if the fetch throws, so a permanently
   stuck entry eventually trips the `>= 5` guard.
4. `POST /api/fuelup` with `application/json` body = the stored
   `FuelSubmissionInput`.
5. Branching on the response:
   - `res.ok` (2xx) → `Queue.markSynced(entry.id)`.
   - `res.status >= 400 && res.status < 500` → `Queue.markFailed(entry.id, ${res.status})`.
   - Anything else (5xx) → no transition; entry stays `'queued'` for
     the next trigger.
6. A thrown error from `fetch` (offline, DNS fail, abort) is caught
   silently — entry stays `'queued'`.

There is no exponential backoff between retries. Each `sync-queue`
message walks the whole queue once.

## Schema versioning

The database version is `1` (the literal `openDB<DbSchema>(name, 1, ...)`
in `idb.ts`). The v0.1.3 `'synced'` status addition was **not** a version
bump.

Reasoning: IndexedDB stores `status` as a plain string and doesn't enforce
the TypeScript union at runtime. Adding a third allowed string doesn't
break existing rows — `'queued'` and `'failed'` rows from previous
versions still load with their original status intact. The only consumer
that would notice is one that does an exhaustive `switch` on the union
and crashes on the default branch — none of the queue consumers do.

If a future change adds a new field, a new index, or reshapes existing
rows, that **will** need a version bump and an `upgrade()` migration.

## Edge cases

### Quota errors

The queue itself doesn't have explicit quota handling — `Queue.enqueue`
throws on `QuotaExceededError`, which the form's submit path swallows
via the outer `catch` (the error toast still fires, the entry just
doesn't land). The synced-row write in `+page.svelte`'s success path
is wrapped in its own `try/catch` and is fire-and-forget — IDB
failures don't affect the success toast.

For the localStorage cache + IDB read-side fallback used by the
prefill resolver, see [`docs/technical/offline-odometer-prefill.md`](./offline-odometer-prefill.md).

### Private browsing mode

Safari Private Browsing disables IndexedDB entirely — `openDB` throws.
The form's submit path catches this in its outer `try/catch` (the queue
fallback is the `catch` branch of the `submitFuelup` call). On private
mode + offline, the user sees an error toast and the submission is
lost. This is documented in the user guide; private browsing isn't a
supported use mode for the PWA.

### Pruning

There is no built-in pruning. Synced rows accumulate at ~200 bytes per
fillup; at 50 fillups/year that's ~10 KB/year. Pruning is parked for a
future release.

## Cross-references

- [`docs/user/offline-queue.md`](../user/offline-queue.md) — user-facing
  behavior, "what does the amber chip mean".
- [`docs/technical/offline-odometer-prefill.md`](./offline-odometer-prefill.md)
  — `'synced'` rows as a permanent-local-history substrate; how the
  resolver consumes them.
- [`docs/technical/service-worker.md`](./service-worker.md) — SW shell
  cache, fetch handler, and message-handler glue.
- [`docs/technical/idb-and-api.md`](./idb-and-api.md) — combined IDB +
  HTTP API reference.
