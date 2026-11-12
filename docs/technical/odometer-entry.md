# Odometer entry page — internals

The `/odometer` route logs an **odometer-only** record (no fuel) to LubeLogger,
optionally tagged with the vehicle's **Equipment** — e.g. an off-road trailer
that should accrue distance toward its own service intervals. It mirrors
LubeLogger's own "Add Odometer Record" form, where equipment shows as a
checkbox list. Works offline through the same queue-and-replay flow as fill-ups. Requested in #97. User-facing tour:
[`docs/user/app-pages.md`](../user/app-pages.md) § _Log Odometer_. The HTTP
endpoints and the `Equipment` type live in [`idb-and-api.md`](./idb-and-api.md).

## How LubeLogger Equipment works

Equipment records belong to a vehicle (`GET /api/vehicle/equipmentrecords`).
Each odometer record carries a list of equipment ids; LubeLogger credits the
record's distance (`odometer − initialOdometer`) to every listed equipment item
and reports the running total as `distanceTraveled`. Fuel records carry no
equipment, which is why this needs its own odometer entry rather than a field
on the fuel form.

quicklogger leaves `initialOdometer` blank. LubeLogger then fills it from the
vehicle's latest odometer record, exactly as its own UI does, so the distance
math stays upstream.

## Files touched

- `src/lib/server/lubelogger.ts` — `EquipmentRecordRaw` / `Equipment` types, `normalizeEquipment()`, and `LubeLoggerClient.listEquipment` + `addOdometerRecord`.
- `src/routes/api/vehicle/equipment/+server.ts` — `GET /api/vehicle/equipment?vehicleId=N`; a thin delegation to `parseVehicleId` + `withLubeLogger`, same as `reminders` / `info`.
- `src/routes/api/odometer/+server.ts` — `POST /api/odometer`; validates (`_validate`, underscore-exported for tests) and forwards to `addOdometerRecord`.
- `src/lib/shared/types.ts` — `OdometerSubmissionInput`.
- `src/lib/client/api.ts` — `listEquipment(id, fetch)` and `submitOdometer(input, fetch)` wrappers.
- `src/routes/odometer/+page.ts` — loader: resolve vehicle → `listEquipment` + `getVehicleInfo` in parallel → `{ vehicle, equipment, lastOdometer, error }`.
- `src/routes/odometer/+page.svelte` — the form.
- `src/routes/+layout.svelte` — `Log Odometer` drawer nav item (between Log Fuel and History).
- `src/routes/vehicles/+page.svelte` — `odometer` entry in the picker `RETURN_TO` allowlist.

## Data model

`Equipment` (`src/lib/server/lubelogger.ts`) is normalized server-side from
LubeLogger's all-string export model (`id: "7"`, `isEquipped: "True"`,
`distanceTraveled: "1240"`) to `{ id: number, description, isEquipped: boolean,
distanceTraveled: number }`. Notes, tags, files and extra fields aren't
modelled.

Persistence:

- **IndexedDB store `pendingOdometer`** (database version 1 → 2; the upgrade only
  adds the store, fuel rows are untouched). `OdometerQueueEntry` mirrors
  `QueueEntry` — `input`, `status`, `attempts`, `enqueuedAt`, `lastError`,
  `deduped` — plus a display-only `equipmentNames` snapshot so `/history` can
  label the row offline. It's a separate store, not a `kind` field on
  `pendingSubmissions`, so every fuel-queue consumer (History pricing, the
  offline fuel prefill in `last-fillup.ts`, `pruneSynced`) keeps seeing only
  rows with fuel fields. See [`offline-queue.md`](./offline-queue.md).
- **localStorage `quicklogger.odometerSnapshot.<vehicleId>`**
  (`src/lib/client/odometer-snapshot.ts`) — `{ equipment, lastOdometer }`, written on
  every successful load and after each logged / queued reading, read by the
  loader only when LubeLogger is unreachable. `lastOdometer` only moves forward.
- No service-worker cache: `/api/vehicle/equipment` and `/api/odometer` fall
  through the SW's generic network-only `/api/` branch.

## Lifecycle / control flow

1. Reached from the drawer (`Log Odometer`) or via the picker round-trip (`/vehicles?from=odometer`).
2. Loader resolves the active vehicle with the shared `resolveSelectedVehicle()` (`URL ?vehicleId= → prefs.lastVehicleId → vehicles[0]`), then fetches equipment and vehicle info in parallel.
3. The odometer field is prefilled from `VehicleInfo.lastReportedOdometer` (LubeLogger's max mileage across all record types) and greyed with a `prefilled` badge — the same visual as the Log Fuel form ([`odometer-prefill.md`](./odometer-prefill.md)). The `+N mi since last reading` line appears once the user edits it.
4. Equipment with `isEquipped: true` starts checked, matching LubeLogger's form.
5. A reading below the last known one shows the smart-check chip ("1 issue found … Submit anyway"), same as Log Fuel; submit is blocked until acknowledged.
6. Submit → `POST /api/odometer` → `addOdometerRecord` (JSON variant of `odometerrecords/add`). On success: green toast naming the equipment, a `'synced'` row in `pendingOdometer` (History trail), `savePrefs({ lastVehicleId })`, then `/maintenance` — the same landing as a logged fill-up, so a reminder the new distance tipped into due shows straight away.
7. On a network error or 5xx: enqueue as `'queued'`, amber toast, land on `/history` (renders from IndexedDB, so the Queued badge is visible offline). A 4xx is a red "Submission rejected" toast and is not queued. The SW drains `pendingOdometer` right after `pendingSubmissions` in the same `syncQueue` run (`drainOdometer`).

## Edge cases & invariants

| Scenario                                 | Behaviour                                                                                       | Why                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Prefilled value left untouched           | Submit disabled                                                                                 | It would log a 0-distance record                                                                             |
| Vehicle has no equipment                 | Hint pointing at LubeLogger's Equipment tab; odometer-only submit allowed                       | The page is still useful for a plain odometer reading                                                        |
| Upstream 2xx with `success: false`       | Treated as `LubeLoggerError(400)`                                                               | LubeLogger reports some validation failures in the body; a rejected record must never look like a logged one |
| Upstream 4xx (e.g. unknown equipment id) | Passed through; red toast                                                                       | Same 4xx passthrough / 5xx → 502 mapping as `/api/fuelup`                                                    |
| `vehicleInfo` / equipment fetch fails    | Falls back to the localStorage snapshot; amber banner says readings will sync later             | The trailer checkbox and prefill must still work in the field                                                |
| Offline submit (network error / 5xx)     | Queued, amber toast, lands on `/history`                                                        | Same as Log Fuel                                                                                             |
| Replay of a POST that already landed     | Server matches `date` + `odometer` upstream, returns `deduped: true`; History shows **Skipped** | Same replay dedupe contract as `/api/fuelup`                                                                 |
| Reading lower than the last one          | Smart-check chip with **Submit anyway**                                                         | Usually a typo; same as Log Fuel                                                                             |
| Duplicate ids in `equipmentIds`          | De-duplicated server-side                                                                       | LubeLogger de-dupes too; keeps the payload clean                                                             |

## Non-obvious decisions

- **Separate store, shared drain.** `pendingOdometer` reuses the fuel queue's state machine, 5-attempt budget, network-error revert, retention bound (`historyKeepPerVehicle`) and `syncing` lock rather than inventing its own.
- **Dedupe key is `date` + `odometer`.** Fuel needs `fuelConsumed` as a third field because two same-day fill-ups can share an offline-prefilled odometer; two odometer-only readings with the same date and value are the same reading.
- **No in-memory idempotency window.** `/api/fuelup` has a 60 s `clientSubmissionId` window for double-taps; here the button disables while a submit is in flight, the SW drain is single-flight, and replays go through the upstream dedupe, so there's no second write path for it to guard.
- **"Log Odometer", not "Log Miles".** The label stays unit-neutral for km instances (#69); figures use `effectiveDistanceUnit()`.
- **JSON variant of `odometerrecords/add`.** It binds `equipmentRecordId` (space-separated ids) the same as multipart, and it's the variant LubeLogger documents for nested fields.
