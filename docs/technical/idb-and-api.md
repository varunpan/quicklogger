# IndexedDB and HTTP API — reference

## Overview

Combined reference for the two stable interfaces the client and the
server expose to each other:

- The IndexedDB object store the client uses for the offline queue
  (source of truth: `src/lib/client/idb.ts`).
- Every `+server.ts` under `src/routes/api/` (HTTP endpoints the page
  and the service worker call).

For the lifecycle and state-machine view of the queue see
[`docs/technical/offline-queue.md`](./offline-queue.md). For the FX
chain that backs `/api/fx` and the FX side of `/api/fuelup` see
[`docs/technical/fx-chain.md`](./fx-chain.md). For LubeLogger-side
mapping see [`docs/api-mapping.md`](../api-mapping.md).

## IndexedDB

### Database

| Property | Value |
|---|---|
| Database name | `quicklogger` |
| Version | `1` |
| Stores | `pendingSubmissions` |

### Object store `pendingSubmissions`

| Property | Value |
|---|---|
| `keyPath` | `id` |
| `autoIncrement` | `true` |
| Indexes | `byStatus` on `status` |

### Row fields (`QueueEntry`)

| Field | Type | Nullable | Purpose |
|---|---|---|---|
| `id` | `number` | no | Auto-assigned primary key. |
| `input` | `FuelSubmissionInput` | no | Verbatim user payload (see below). |
| `status` | `'queued' \| 'failed' \| 'synced'` | no | Sync state. |
| `attempts` | `number` | no | Replay attempt counter, capped at `5`. |
| `enqueuedAt` | `number` | no | `Date.now()` at enqueue time (ms epoch). |
| `lastError` | `string` | yes | Response status string on failed replay (set by `markFailed`). |

### `FuelSubmissionInput` shape

Source: `src/lib/shared/types.ts`.

| Field | Type | Notes |
|---|---|---|
| `vehicleId` | `number` | LubeLogger vehicle id. |
| `date` | `string` | ISO `YYYY-MM-DD`. |
| `odometer` | `number` | Integer-ish miles (server `.toString()`s it). |
| `volume` | `number` | In `volumeUnit`. |
| `volumeUnit` | `'gal' \| 'L'` | Form toggle. |
| `cost` | `number` | In `currency`. |
| `currency` | `string` | ISO 4217 code, uppercase (form ships USD/CAD/EUR/GBP/MXN). |
| `isFillToFull` | `boolean` | |
| `missedFuelup` | `boolean` | |
| `notes` | `string` | Optional. |
| `tags` | `string` | Optional, comma-separated on the LubeLogger side. |
| `manualFxRate` | `number` | Optional; bypasses the FX chain when set. |
| `clientSubmissionId` | `string` | UUID for the server's idempotency cache (60 s window). |

### Public surface

`Queue` class methods (`src/lib/client/idb.ts`):

| Method | Effect |
|---|---|
| `Queue.open(name?)` | Open / create the DB. Default name `quicklogger`. |
| `enqueue(input, status?)` | Insert a row. Default status `'queued'`. |
| `list()` | Return every row in the store. |
| `remove(id)` | Delete a row. (Not currently called by app code; reserved.) |
| `markFailed(id, error)` | Set status `'failed'` and `lastError = error`. No-op if id missing. |
| `markSynced(id)` | Set status `'synced'`. No-op if id missing. |
| `incrementAttempts(id)` | `attempts += 1`. No-op if id missing. |

## HTTP API

All endpoints live under `src/routes/api/`. No app-side authentication
— these routes assume same-origin requests from the page or the
service worker, and the server-side LubeLogger key (`LUBELOGGER_API_KEY`,
loaded via `loadEnv()`) authenticates the upstream calls.

### `GET /api/vehicles`

Source: `src/routes/api/vehicles/+server.ts`.

| Field | Value |
|---|---|
| Request | No params. |
| Cache | In-memory `TtlCache` keyed on `'vehicles'`, 5-minute TTL. |
| Response 200 | `Vehicle[]` from LubeLogger's `/api/vehicles`. |
| Response 502 | `{ error: string }` — LubeLogger returned an error (`LubeLoggerError`). |
| Response 500 | `{ error: string }` — anything else (env missing, network failure, etc.). |

`Vehicle` shape (`src/lib/server/lubelogger.ts`):

```ts
{ id: number; year?: number; make?: string; model?: string; [k: string]: unknown }
```

### `GET /api/vehicle/last-fuelup?vehicleId=<id>`

Source: `src/routes/api/vehicle/last-fuelup/+server.ts`.

| Field | Value |
|---|---|
| Request | Query: `vehicleId` (required, finite number). |
| Cache | None — every request hits LubeLogger. |
| Response 200 | `GasRecord` (the latest by `parseDate(record.date)`) or `null` (if no records). |
| Response 400 | `{ error: 'vehicleId required' }` or `{ error: 'invalid vehicleId' }`. |
| Response 502 | `{ error: string }` — `LubeLoggerError` from upstream. |
| Response 500 | `{ error: string }` — any other error. |

`GasRecord` shape: all values are LubeLogger-style stringified
(`odometer: "87432"`, `cost: "42.18"` etc.). Date format `M/D/YYYY`.
See `src/lib/server/lubelogger.ts` for the full type.

### `GET /api/fx?from=<code>&to=<code>`

Source: `src/routes/api/fx/+server.ts`. Backed by `CurrencyService` —
see [`docs/technical/fx-chain.md`](./fx-chain.md) for the resolution
flow.

| Field | Value |
|---|---|
| Request | Query: `from`, `to`. Both uppercased server-side. |
| Cache | Persistent on-disk JSON at `FX_CACHE_PATH` (default `/data/fx-cache.json`). |
| Response 200 | `{ rate: number, source: string, fetchedAt: number, stale: boolean, ageHours: number }` |
| Response 400 | `{ error: 'from and to required' }` if either param is empty. |
| Response 503 | `{ available: false }` — `FxUnavailableError` (no provider succeeded and no usable cache). The page interprets this as "show the manual-FX field". |
| Response 500 | `{ error: string }` — any other error. |

### `POST /api/fuelup`

Source: `src/routes/api/fuelup/+server.ts`. The single submit endpoint.

| Field | Value |
|---|---|
| Request body | `application/json` or `application/x-www-form-urlencoded` or `multipart/form-data`. |
| Required fields | `vehicleId`, `date`, `odometer`, `volume`, `volumeUnit`, `cost`, `currency`, `clientSubmissionId`. |
| Numeric guard | `odometer`, `volume`, `cost` must be finite and `> 0`. `date` must be a non-empty string. |
| Idempotency | 60-second in-memory window keyed on `clientSubmissionId`. Repeat POSTs in the window return the original cached response. |

#### Success response (200)

```json
{
  "ok": true,
  "submitted": {
    "gallons": 11.23,
    "cost": 42.18,
    "fxRate": 1.0,
    "fxSource": "frankfurter",
    "fxStale": false
  }
}
```

#### Error responses

| Status | Body | When |
|---|---|---|
| 400 | `{ error: 'unsupported content-type: ...' }` | Body parse failed. |
| 400 | `{ error: 'missing fields: ...' }` | Required field missing or null. |
| 400 | `{ error: 'invalid fields (must be > 0 / non-empty): ...' }` | Zero/negative/NaN on a numeric field or empty `date`. |
| 4xx | `{ error: string, status: number, body: string }` | `LubeLoggerError` with upstream 4xx — re-emitted with same status. |
| 502 | `{ error: string, status: number, body: string }` | `LubeLoggerError` with upstream 5xx — re-emitted as 502. |
| 500 | `{ error: string }` | FX unavailable (no manual rate set), env missing, or any other thrown error. |

The 4xx-passthrough is what the SW replay loop relies on: it marks the
queue entry `'failed'` exactly when the response is `>= 400 && < 500`.
5xx responses (including the 502 LubeLogger-upstream branch) leave the
entry `'queued'` for the next sync trigger.

### Why no `/api/manifest.webmanifest`

`manifest.webmanifest` is a static file under `static/`, served by the
SvelteKit static handler — not an `+server.ts` route. It's precached
by the service worker via the `files` array.

## Cross-references

- [`docs/api-mapping.md`](../api-mapping.md) — how these endpoints
  map onto upstream LubeLogger's `/api/vehicles` and
  `/api/vehicle/gasrecords*` calls.
- [`docs/technical/offline-queue.md`](./offline-queue.md) — queue
  lifecycle and replay path.
- [`docs/technical/fx-chain.md`](./fx-chain.md) — the FX side of
  `/api/fx` and `/api/fuelup`.
- [`docs/technical/service-worker.md`](./service-worker.md) — fetch
  handler routing rules.
