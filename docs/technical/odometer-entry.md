# Odometer entry page — internals

The `/odometer` route logs an **odometer-only** record (no fuel) to LubeLogger,
crediting the vehicle's **Equipped** items — e.g. an off-road trailer or a
roof tent that should accrue its own distance. Each item has an **Equip** /
**Unequip** button that logs the reading and flips the item's Equipped flag in
LubeLogger, so equipment goes on and off without LubeLogger's UI. Works offline through the same queue-and-replay flow as fill-ups. Requested in #97. User-facing tour:
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

- `src/lib/server/lubelogger.ts` — `EquipmentRecordRaw` / `Equipment` types, `normalizeEquipment()`, and `LubeLoggerClient.listEquipment` / `setEquipmentEquipped` / `listOdometerRecords` / `addOdometerRecord`, sharing one `expectSuccess` check.
- `src/routes/api/vehicle/equipment/+server.ts` — `GET /api/vehicle/equipment?vehicleId=N` (a thin `parseVehicleId` + `withLubeLogger` delegation, same as `reminders` / `info`) (the Equipped flag is set through `POST /api/odometer`'s `setEquipped`).
- `src/routes/api/odometer/+server.ts` — `POST /api/odometer`; validates (`_validate`, underscore-exported for tests) and forwards to `addOdometerRecord`.
- `src/lib/shared/types.ts` — `OdometerSubmissionInput`.
- `src/lib/client/api.ts` — `listEquipment` and `submitOdometer` wrappers.
- `src/lib/client/equipment-state.ts` — `applyPendingEquipment`: shows queued Equip / Unequip rows as already applied (`pending`).
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
  (`src/lib/client/odometer-snapshot.ts`) — `{ equipment?, equipmentSavedAt?, lastOdometer? }`,
  a mirror of LubeLogger's last answer: every successful load overwrites it,
  and nothing the user types is written to it. Read only for whatever
  couldn't be fetched. `equipment` is absent until the list has loaded once,
  which is how the page tells "never loaded" from "no equipment".
- No service-worker cache: `/api/vehicle/equipment` and `/api/odometer` fall
  through the SW's generic network-only `/api/` branch.

## Lifecycle / control flow

1. Reached from the drawer (`Log Odometer`) or via the picker round-trip (`/vehicles?from=odometer`).
2. Loader resolves the active vehicle with the shared `resolveSelectedVehicle()` (`URL ?vehicleId= → prefs.lastVehicleId → vehicles[0]`), then fetches equipment and vehicle info in parallel.
3. The odometer field prefills from `VehicleInfo.lastReportedOdometer` (LubeLogger's max mileage across all record types; the snapshot's copy when offline), raised to the highest local reading for the vehicle (odometer or fuel) — like `resolveOfflineLastFillup` does for fuel. `'queued'` rows always count; `'synced'` rows count only when LubeLogger couldn't be reached (online, LubeLogger's figure is authoritative, so a correction made there wins); `'failed'` rows never count, so a mistyped reading LubeLogger refused can't steer the prefill. Greyed with a `prefilled` badge, as on Log Fuel ([`odometer-prefill.md`](./odometer-prefill.md)); the `+N mi since last reading` line appears once edited.
4. **Log odometer** credits every item LubeLogger marks Equipped (`equipmentIds` = the equipped ids) — the same rule LubeLogger applies to the odometer records it auto-inserts for fill-ups, so readings and fill-ups agree. There are no per-reading ticks. If the list has never loaded on this device (offline, fresh install), the page says so and the reading carries `includeEquipped: true`: the server attaches whatever is Equipped when it writes the record.
   **Equip / Unequip** (one button per item): logs the odometer entered above, crediting what is Equipped _before_ the change (Equip: the item isn't on yet, so the miles it didn't travel are closed out; Unequip: it is, so it gets the miles up to now), with a default note "Equipped …" / "Unequipped …", and carries `setEquipped` so the server flips the flag after writing the reading — **one request, and one queued row offline**, so the pair always lands together and in the order tapped. Lands like a plain reading: `/maintenance` on success, `/history` when queued. Queued Equip / Unequip rows are shown as already applied with a "waiting to sync" tag (`applyPendingEquipment` in the loader), so later offline readings count toward the item, matching what LubeLogger will hold after the in-order replay. When the list comes from the offline snapshot, this device's Equip / Unequip made after the snapshot's `equipmentSavedAt` are applied too, even once synced — otherwise an offline Equip that synced before any online reload would show as not Equipped and offer Equip instead of Unequip (found in phone testing). If the flag fails after the reading landed (502), the row stays queued and its replay's dedupe skips the reading and retries just the flag.
5. When SvelteKit reuses the page for a different vehicle (e.g. `/odometer?vehicleId=2` → drawer → `/odometer` for vehicle 1), an `$effect.pre` keyed on the vehicle id re-seeds the odometer, equipment ticks and notes; same-vehicle reloads never clobber typing.
6. A reading below the last known one shows the smart-check chip ("1 issue found … Submit anyway"), same as Log Fuel; submit is blocked until acknowledged.
7. Submit → `POST /api/odometer` (with a `clientSubmissionId`) → the server reads the vehicle's odometer records, works out the trip start, and calls `addOdometerRecord` (JSON variant of `odometerrecords/add`). On success: green toast naming the equipment, a `'synced'` row in `pendingOdometer` (History trail), `savePrefs({ lastVehicleId })`, then `/maintenance` — the same landing as a logged fill-up, so a reminder the new distance tipped into due shows straight away.
8. On a network error or 5xx: enqueue as `'queued'`, amber toast, land on `/history` (renders from IndexedDB, so the Queued badge is visible offline). A 4xx is a red "Submission rejected" toast and is not queued. The SW drains both queues in one `syncQueue` run, in the order entries were made (`enqueuedAt`), through one shared `replayEntry`.

## Edge cases & invariants

| Scenario                                                                              | Behaviour                                                                                                                                               | Why                                                                                                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Prefilled value left untouched                                                        | Submit disabled                                                                                                                                         | It would log a 0-distance record                                                                                       |
| Vehicle has no equipment                                                              | Hint pointing at LubeLogger's Equipment tab; odometer-only submit allowed                                                                               | The page is still useful for a plain odometer reading                                                                  |
| Upstream 2xx with `success: false`                                                    | `"Access Denied"` → 403 (permanent); anything else → 502 (retried); reason logged                                                                       | LubeLogger's permission filters answer 200 + `success: false`; validation / storage errors use real 400 / 500 statuses |
| Upstream 2xx with a non-JSON body                                                     | 502 (retried), logged                                                                                                                                   | e.g. an auth proxy's HTML page — never reported as logged                                                              |
| Upstream 4xx (e.g. unknown equipment id)                                              | Passed through; red toast                                                                                                                               | Same 4xx passthrough / 5xx → 502 mapping as `/api/fuelup`                                                              |
| `vehicleInfo` / equipment fetch fails                                                 | Falls back to the localStorage snapshot; amber banner says readings will sync later; Equip / Unequip disabled                                           | Readings still credit the cached Equipped items and the prefill still works in the field                               |
| Offline submit (network error / 5xx)                                                  | Queued, amber toast, lands on `/history`                                                                                                                | Same as Log Fuel                                                                                                       |
| Replay of a POST that already landed                                                  | A record at the same date + odometer has the same notes, and the records there carry every item it credits → `deduped: true`; History shows **Skipped** | Same replay dedupe contract as `/api/fuelup`; also matches when the write plan split the equipment                     |
| `includeEquipped` replay after the equipped set changed                               | Matched on the explicitly sent items only                                                                                                               | The equipped extras were resolved when the original was written                                                        |
| A record already at the same date + odometer (re-logged reading, fill-up auto-insert) | Counts as before: the new record is a zero-length trip                                                                                                  | Nothing credited twice; matches LubeLogger's recalculate order                                                         |
| Records / equipment pre-check returns a 4xx (revoked key, no access)                  | Passed through — "Submission rejected", a queued entry fails at once                                                                                    | A retry can't succeed; only 5xx / network failures get 503                                                             |
| Replay arrives while the original write is still in flight                            | Shares the first request's result (60 s `clientSubmissionId` window)                                                                                    | The record isn't upstream yet, so the dedupe alone can't see it                                                        |
| Equipment list never loaded (offline, fresh install)                                  | Amber note; reading carries `includeEquipped: true`                                                                                                     | So a trailer marked equipped still gets the distance                                                                   |
| Reading lower than the last one                                                       | Smart-check chip with **Submit anyway**                                                                                                                 | Usually a typo; same as Log Fuel                                                                                       |
| Duplicate ids in `equipmentIds`                                                       | De-duplicated server-side                                                                                                                               | LubeLogger de-dupes too; keeps the payload clean                                                                       |

## Non-obvious decisions

- **Equipped is the single source of truth; Equip / Unequip write it.** LubeLogger credits equipment on the odometer records it auto-inserts for fill-ups only via the Equipped flag, so per-reading ticks could disagree with fill-ups mid-trip (the trailer silently missing every leg before the last fuel stop). Making the page's readings follow the same flag, and letting the page set it, keeps both in step and means the user never needs LubeLogger's UI. Wording stays LubeLogger's ("Equip" / "Equipped") because the item may be a trailer, a roof tent, a rack or tires.
- **Reading and flag in one request.** Two calls (reading, then flag) couldn't be queued as a unit, so Equip / Unequip were online-only — useless at a trailhead. Carrying `setEquipped` on the reading makes the pair one idempotent, replayable row: the replay dedupe recognises a landed reading and just finishes the flag. Known limit: an Equipped change made in LubeLogger's own UI while the phone still has an unsynced Equip / Unequip is overwritten when the phone syncs (last write wins, in tap order).
- **Setting Equipped preserves the rest of the record.** LubeLogger's `equipmentrecords/update` replaces notes, tags, extra fields and files with whatever is sent, so `setEquipmentEquipped` reads the current record and sends it back with only `isEquipped` changed (and checks the item belongs to the vehicle).

- **Separate database, shared queue code.** `RecordQueue` holds list / attempts / dead-lettering / retention once for both queues, and `replayEntry` is the one replay state machine, so a fix to either reaches fuel and odometer alike.
- **Trip start sent explicitly.** Left blank, LubeLogger starts the trip at the vehicle's _highest_ odometer record regardless of date, so a trailer reading entered after a higher record (the auto-inserted record of a later fill-up, an out-of-order replay) gets a zero or negative distance. The server sends the odometer of the record just before ours in LubeLogger's own `recalculate` order (date, then odometer), capped at the reading itself.
- **A same-reading record counts as before.** A record already at the same date + odometer is either the same reading logged twice (e.g. once before Equip and again after) or a fill-up's auto-insert. Either way that leg is already covered, so the new record is zero-length — where LubeLogger's recalculate puts it. An earlier per-item rule credited the trip to items the existing record lacked; live testing showed it charging the trailer the truck's solo miles on a re-logged reading, so it was dropped. Trade-off: if the trailer was hitched but not marked Equipped when a fill-up auto-inserted a record, that leg isn't credited to the trailer — the same as in LubeLogger itself.
- **Replay dedupe asks "is everything this reading adds already there?"** — a same-reading record with our notes, and the same-reading records together carrying every item it credits. Date + odometer alone matched auto-inserted fill-up records and dropped real readings.
- **Same 60 s duplicate guard as fuel.** `IdempotencyWindow` (`$lib/server/idempotency.ts`) is shared with `/api/fuelup`.
- **"Log Odometer", not "Log Miles".** The label stays unit-neutral for km instances (#69); figures use `effectiveDistanceUnit()`.
- **JSON variant of `odometerrecords/add`.** It binds `equipmentRecordId` (space-separated ids) the same as multipart, and it's the variant LubeLogger documents for nested fields.
