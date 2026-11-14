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

- **IndexedDB database `quicklogger-odometer`** (version 1, store
  `pendingOdometer`) — a separate database, not a second store in
  `quicklogger`, so the fuel database never needs a version bump. A bump
  would wait on every v1 connection already open (an old-build tab, the
  outgoing SW), and those never close, so it could hang both queues.
  `OdometerQueueEntry` has the same shape and status machine as `QueueEntry`,
  minus `converted`, plus a display-only `equipmentNames` snapshot so
  `/history` can label the row offline. Both queues share one implementation
  (`RecordQueue` in `idb.ts`). See [`offline-queue.md`](./offline-queue.md).
- **localStorage `quicklogger.odometerSnapshot.<vehicleId>`**
  (`src/lib/client/odometer-snapshot.ts`) — `{ equipment?, lastOdometer? }`,
  a mirror of LubeLogger's last answer: every successful load overwrites it,
  and nothing the user types is written to it. Read only for whatever
  couldn't be fetched. `equipment` is absent until the list has loaded once,
  which is how the page tells "never loaded" from "no equipment".
- No service-worker cache: `/api/vehicle/equipment` and `/api/odometer` fall
  through the SW's generic network-only `/api/` branch.

## Lifecycle / control flow

1. Reached from the drawer (`Log Odometer`) or via the picker round-trip (`/vehicles?from=odometer`).
2. Loader resolves the active vehicle with the shared `resolveSelectedVehicle()` (`URL ?vehicleId= → prefs.lastVehicleId → vehicles[0]`), then fetches equipment and vehicle info in parallel.
3. The odometer field prefills from `VehicleInfo.lastReportedOdometer` (LubeLogger's max mileage across all record types; the snapshot's copy when offline), raised to the highest reading still **queued** for the vehicle (odometer or fuel) — like `resolveOfflineLastFillup` does for fuel. `'failed'` rows don't count, so a mistyped reading LubeLogger refused can't steer the prefill. Greyed with a `prefilled` badge, as on Log Fuel ([`odometer-prefill.md`](./odometer-prefill.md)); the `+N mi since last reading` line appears once edited.
4. Equipment with `isEquipped: true` starts checked, matching LubeLogger's form. If the list has never loaded on this device (offline, fresh install), the page says so and the reading carries `includeEquipped: true`: the server attaches whatever LubeLogger marks equipped when it writes the record.
5. When SvelteKit reuses the page for a different vehicle (e.g. `/odometer?vehicleId=2` → drawer → `/odometer` for vehicle 1), an `$effect.pre` keyed on the vehicle id re-seeds the odometer, equipment ticks and notes; same-vehicle reloads never clobber typing.
6. A reading below the last known one shows the smart-check chip ("1 issue found … Submit anyway"), same as Log Fuel; submit is blocked until acknowledged.
7. Submit → `POST /api/odometer` (with a `clientSubmissionId`) → the server reads the vehicle's odometer records, works out the trip start, and calls `addOdometerRecord` (JSON variant of `odometerrecords/add`). On success: green toast naming the equipment, a `'synced'` row in `pendingOdometer` (History trail), `savePrefs({ lastVehicleId })`, then `/maintenance` — the same landing as a logged fill-up, so a reminder the new distance tipped into due shows straight away.
8. On a network error or 5xx: enqueue as `'queued'`, amber toast, land on `/history` (renders from IndexedDB, so the Queued badge is visible offline). A 4xx is a red "Submission rejected" toast and is not queued. The SW drains both queues in one `syncQueue` run, in the order entries were made (`enqueuedAt`), through one shared `replayEntry`.

## Edge cases & invariants

| Scenario                                                                          | Behaviour                                                                                                           | Why                                                                                                                    |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Prefilled value left untouched                                                    | Submit disabled                                                                                                     | It would log a 0-distance record                                                                                       |
| Vehicle has no equipment                                                          | Hint pointing at LubeLogger's Equipment tab; odometer-only submit allowed                                           | The page is still useful for a plain odometer reading                                                                  |
| Upstream 2xx with `success: false`                                                | `"Access Denied"` → 403 (permanent); anything else → 502 (retried); reason logged                                   | LubeLogger's permission filters answer 200 + `success: false`; validation / storage errors use real 400 / 500 statuses |
| Upstream 2xx with a non-JSON body                                                 | 502 (retried), logged                                                                                               | e.g. an auth proxy's HTML page — never reported as logged                                                              |
| Upstream 4xx (e.g. unknown equipment id)                                          | Passed through; red toast                                                                                           | Same 4xx passthrough / 5xx → 502 mapping as `/api/fuelup`                                                              |
| `vehicleInfo` / equipment fetch fails                                             | Falls back to the localStorage snapshot; amber banner says readings will sync later                                 | The trailer checkbox and prefill must still work in the field                                                          |
| Offline submit (network error / 5xx)                                              | Queued, amber toast, lands on `/history`                                                                            | Same as Log Fuel                                                                                                       |
| Replay of a POST that already landed                                              | Server matches date + odometer + equipment set + notes upstream, returns `deduped: true`; History shows **Skipped** | Same replay dedupe contract as `/api/fuelup`                                                                           |
| Same date + odometer, different equipment (e.g. a fill-up's auto-inserted record) | Written, with the trip start from the record before it                                                              | A different real reading must never be dropped                                                                         |
| Replay arrives while the original write is still in flight                        | Shares the first request's result (60 s `clientSubmissionId` window)                                                | The record isn't upstream yet, so the dedupe alone can't see it                                                        |
| Equipment list never loaded (offline, fresh install)                              | Amber note; reading carries `includeEquipped: true`                                                                 | So a trailer marked equipped still gets the distance                                                                   |
| Reading lower than the last one                                                   | Smart-check chip with **Submit anyway**                                                                             | Usually a typo; same as Log Fuel                                                                                       |
| Duplicate ids in `equipmentIds`                                                   | De-duplicated server-side                                                                                           | LubeLogger de-dupes too; keeps the payload clean                                                                       |

## Non-obvious decisions

- **Separate database, shared queue code.** `RecordQueue` holds list / attempts / dead-lettering / retention once for both queues, and `replayEntry` is the one replay state machine, so a fix to either reaches fuel and odometer alike.
- **Trip start sent explicitly.** Left blank, LubeLogger starts the trip at the vehicle's _highest_ odometer record regardless of date, so a trailer reading entered after a higher record (the auto-inserted record of a later fill-up, an out-of-order replay) gets a zero or negative distance. The server sends the odometer of the record just before ours in LubeLogger's own `recalculate` order (date, then odometer), capped at the reading itself.
- **Dedupe key is everything we write.** Date + odometer alone matched LubeLogger's auto-inserted fill-up records (they carry only "equipped" equipment) and dropped real readings; the equipment set and notes must match too.
- **Same 60 s duplicate guard as fuel.** `IdempotencyWindow` (`$lib/server/idempotency.ts`) is shared with `/api/fuelup`.
- **"Log Odometer", not "Log Miles".** The label stays unit-neutral for km instances (#69); figures use `effectiveDistanceUnit()`.
- **JSON variant of `odometerrecords/add`.** It binds `equipmentRecordId` (space-separated ids) the same as multipart, and it's the variant LubeLogger documents for nested fields.
