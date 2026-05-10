# API mapping

## LubeLogger upstream calls

The server module `src/lib/server/lubelogger.ts` is the only place
quicklogger talks to LubeLogger. All requests carry `x-api-key:
${LUBELOGGER_API_KEY}`. Base URL is `${LUBELOGGER_URL}` — typically
`http://<lubelog-service>:8080` when both containers share a Docker
network, or a public URL otherwise.

| quicklogger method | LubeLogger endpoint | Notes |
|---|---|---|
| `listVehicles()` | `GET /api/vehicles` | Returns array of `Vehicle` |
| `listGasRecords(vehicleId)` | `GET /api/vehicle/gasrecords?vehicleId=N` | Returns array of `GasRecord` |
| `addGasRecord(vehicleId, payload)` | `POST /api/vehicle/gasrecords/add?vehicleId=N` | Body is `multipart/form-data` |

`addGasRecord` form-data fields (LubeLogger schema, all stringly-typed):
- `date` — `MM/DD/YYYY`
- `odometer` — integer as string
- `fuelconsumed` — decimal as string, in LubeLogger's configured unit (gallons_us by default)
- `isfilltofull` — `'true'` | `'false'`
- `missedfuelup` — `'true'` | `'false'`
- `cost` — decimal as string, in LubeLogger's configured currency
- `notes` — optional
- `tags` — optional

`listGasRecords` returns records in LubeLogger's **camelCase** shape (note the casing — different from the lowercase form-data field names accepted by `addGasRecord`):

- `id` — string (`"1"`)
- `vehicleId` — string
- `date` — `M/D/YYYY` (US locale)
- `odometer` — string
- `fuelConsumed` — string, decimal in LubeLogger's configured volume unit
- `cost` — string, decimal in LubeLogger's configured currency (optional)
- `fuelEconomy` — string (optional)
- `isFillToFull` — `'True'` | `'False'`
- `missedFuelUp` — `'True'` | `'False'`
- `notes` — string (optional)
- `tags` — string, comma-separated (optional)
- `extraFields`, `files` — arrays, usually empty

The asymmetry (camelCase reads, lowercase writes) is LubeLogger's own quirk — its POST handler is case-insensitive on form-data field names, but its GET handler returns whatever camelCase shape its model serializes. We mirror both directions in our `GasRecord` and `AddGasRecordPayload` interfaces.

Errors: any non-2xx response throws `LubeLoggerError` with `status` and
`body` properties. The error name is `'LubeLoggerError'` so route
handlers can `instanceof`-check.

Timeout: 5 seconds per request (configurable). Abort signal cancels
the underlying fetch.

## quicklogger endpoints

### `GET /healthz`

Liveness + LubeLogger reachability probe.

- 200 `{ ok: true }` if process is up and LubeLogger responded to
  `/api/vehicles` within 2 seconds.
- 503 `{ ok: false, error: string }` otherwise.

Used by Traefik for routing decisions and by Dockhand for container
health tracking. No auth required (LAN-trust model).

### `GET /api/vehicles`

Returns the LubeLogger vehicle list verbatim, JSON array.

- Cached in-memory for 5 minutes (per-process, no Redis). Reduces
  upstream chatter when the form mounts repeatedly.
- 502 if LubeLogger is unreachable or returns non-2xx — the service
  worker treats this as queue-eligible if the call is part of a
  submission flow.
- No params. No request body. No auth (LAN-trust).

### `GET /api/vehicle/last-fuelup?vehicleId=N`

Returns the most recent `GasRecord` for the given vehicle, by date,
or `null` if the vehicle has no records yet. Used by the form to
compute "MPG since last fill" and pre-fill date defaults.

- 400 on missing or non-numeric `vehicleId`.
- 502 on LubeLogger upstream error.
- Not cached — the form only calls this once per session.

### `GET /api/fx?from=USD&to=CAD`

Returns the FX rate between two ISO 4217 currencies, applying the
chain + cache logic described in `docs/architecture.md` § FX provider
chain.

**200 success body:**
```json
{
  "rate": 1.36,
  "source": "frankfurter",
  "fetchedAt": 1747920000000,
  "stale": false,
  "ageHours": 2.4
}
```

`source` is `'identity'` when from === to. `stale: true` indicates
the response came from a cache > 24h old (still acceptable, < 7d).

**503 unavailable body:**
```json
{ "available": false }
```

This signals the UI to reveal the manual-override field. The user can
then enter the FX rate themselves; the form posts `manualFxRate` to
`/api/fuelup`.

400 if `from` or `to` is missing.

### `POST /api/fuelup`

Submits a fuel record to LubeLogger after applying unit + currency
conversion. Accepts both `application/json` (Apple Shortcut direct-POST
or fetch from the SPA) and `application/x-www-form-urlencoded` /
`multipart/form-data` (HTML form fallback).

**Request body (`FuelSubmissionInput`):**

```json
{
  "vehicleId": 1,
  "date": "2026-05-08",
  "odometer": 87432,
  "volume": 50,
  "volumeUnit": "L",
  "cost": 65,
  "currency": "CAD",
  "isFillToFull": true,
  "missedFuelup": false,
  "notes": "optional",
  "tags": "optional",
  "manualFxRate": 0.72,
  "clientSubmissionId": "00000000-0000-0000-0000-000000000001"
}
```

`manualFxRate` is optional — if present, the FX chain is bypassed and
the rate is recorded with `source: manual`.

`clientSubmissionId` is required — a UUID generated client-side. The
backend deduplicates within a 60-second window so double-tap or
service-worker-retry races don't double-log.

**200 success body (`FuelSubmissionResult`):**

```json
{
  "ok": true,
  "submitted": {
    "gallons": 13.21,
    "cost": 47.45,
    "fxRate": 0.73,
    "fxSource": "frankfurter",
    "fxStale": false
  }
}
```

**Errors:**
- 400 — body parse error or missing required fields
- 502 — LubeLogger 5xx or unreachable; service worker should queue
- 401/4xx — passed through from LubeLogger when applicable
- 500 — unexpected error
