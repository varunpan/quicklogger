# Odometer entry page — internals

The `/odometer` route logs an **odometer-only** record (no fuel) to LubeLogger,
optionally tagged with the vehicle's **Equipment** — e.g. an off-road trailer
that should accrue distance toward its own service intervals. It mirrors
LubeLogger's own "Add Odometer Record" form, where equipment shows as a
checkbox list. Online-only. Requested in #97. User-facing tour:
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

No new persistence — no IndexedDB store, no localStorage key, no
service-worker cache. `/api/vehicle/equipment` and `/api/odometer` fall through
the SW's generic network-only `/api/` branch.

## Lifecycle / control flow

1. Reached from the drawer (`Log Odometer`) or via the picker round-trip (`/vehicles?from=odometer`).
2. Loader resolves the active vehicle with the shared `resolveSelectedVehicle()` (`URL ?vehicleId= → prefs.lastVehicleId → vehicles[0]`), then fetches equipment and vehicle info in parallel.
3. The odometer field is prefilled from `VehicleInfo.lastReportedOdometer` (LubeLogger's max mileage across all record types) and greyed with a `prefilled` badge — the same visual as the Log Fuel form ([`odometer-prefill.md`](./odometer-prefill.md)). The `+N mi since last reading` line appears once the user edits it.
4. Equipment with `isEquipped: true` starts checked, matching LubeLogger's form.
5. Submit → `POST /api/odometer` → `addOdometerRecord` (JSON variant of `odometerrecords/add`). On success: green toast naming the equipment, `invalidateAll()`, and the field re-prefills from the refreshed `lastReportedOdometer`.

## Edge cases & invariants

| Scenario                                 | Behaviour                                                                 | Why                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Prefilled value left untouched           | Submit disabled                                                           | It would log a 0-distance record                                                                             |
| Vehicle has no equipment                 | Hint pointing at LubeLogger's Equipment tab; odometer-only submit allowed | The page is still useful for a plain odometer reading                                                        |
| Upstream 2xx with `success: false`       | Treated as `LubeLoggerError(400)`                                         | LubeLogger reports some validation failures in the body; a rejected record must never look like a logged one |
| Upstream 4xx (e.g. unknown equipment id) | Passed through; red toast                                                 | Same 4xx passthrough / 5xx → 502 mapping as `/api/fuelup`                                                    |
| `vehicleInfo` fails but equipment loads  | No prefill; form still works                                              | Prefill is a convenience                                                                                     |
| Equipment fetch fails                    | Amber "Couldn't reach LubeLogger" banner                                  | Same as `/maintenance` / `/stats`                                                                            |
| Offline                                  | Red toast: odometer entries need a connection                             | Not queued — see below                                                                                       |
| Duplicate ids in `equipmentIds`          | De-duplicated server-side                                                 | LubeLogger de-dupes too; keeps the payload clean                                                             |

## Non-obvious decisions

- **Online-only, no offline queue.** The fuel queue (`pendingSubmissions`, SW replay, replay dedupe) is shaped around gas records. Odometer entries are infrequent and usually made at home after a trip, so they don't justify a second queue. Revisit if that changes.
- **No idempotency window.** `/api/fuelup` has one because the SW replay can race a foreground submit. Nothing replays `/api/odometer`; the button disables while a submit is in flight.
- **"Log Odometer", not "Log Miles".** The label stays unit-neutral for km instances (#69); figures use `effectiveDistanceUnit()`.
- **JSON variant of `odometerrecords/add`.** It binds `equipmentRecordId` (space-separated ids) the same as multipart, and it's the variant LubeLogger documents for nested fields.
