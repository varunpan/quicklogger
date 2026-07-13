# Stats page — internals

The `/stats` route shows LubeLogger's aggregate running-cost numbers for the
active vehicle: total cost of ownership, a per-category cost breakdown, the
last reported odometer, an optional purchase-price line, and a compact reminder
summary. Read-only, online-only. User-facing tour:
[`docs/user/app-pages.md`](../user/app-pages.md) § _Stats_. The HTTP endpoint
and the `VehicleInfo` type live in [`idb-and-api.md`](./idb-and-api.md).

## Files touched

- `src/routes/api/vehicle/info/+server.ts` — `GET /api/vehicle/info?vehicleId=N`; validate, call the client, map errors (502 on `LubeLoggerError`, 500 otherwise).
- `src/lib/server/lubelogger.ts` — `VehicleInfo` type + `LubeLoggerClient.getVehicleInfo` (unwraps LubeLogger's 1-element array).
- `src/lib/client/api.ts` — `getVehicleInfo(id, fetch)` wrapper.
- `src/lib/client/stats.ts` — pure display helpers (`totalCostOfOwnership`, `totalRecordCount`, `costRows`, `reminderSummary`, `purchasePrice`).
- `src/routes/stats/+page.ts` — loader: resolve vehicle → `getVehicleInfo` → `{ vehicle, info, error }`.
- `src/routes/stats/+page.svelte` — renders the cards / states; thin, all math in `stats.ts`. Also mounts the shared `<VehicleIdentifiersCard>` (Plate + VIN) below the vehicle card with `typeof === 'string'` guards — same component as `/maintenance`; see [`vehicle-identifiers.md`](./vehicle-identifiers.md).
- `src/routes/+layout.svelte` — `Stats` drawer nav item (between Maintenance and Vehicles).
- `src/routes/vehicles/+page.svelte` — `stats` entry in the picker `RETURN_TO` allowlist.

## Data model

`VehicleInfo` (`src/lib/server/lubelogger.ts`) is the unwrapped element of
LubeLogger's `GET /api/vehicle/info` 1-element array. Five `{category}RecordCount`

- `{category}RecordCost` pairs (gas/service/repair/upgrade/tax), `lastReportedOdometer`,
  four reminder-count buckets, and `nextReminder: Reminder | null` (modelled but no
  longer rendered — see _Non-obvious decisions_). `vehicleData` reuses the loose
  `Vehicle` type. `plan*` counts exist upstream but are not modelled.

Helper return shapes (`src/lib/client/stats.ts`): `CostRow { label, cost, count, noun }`
and `ReminderSummary { pastDue, upcoming } | null`.

No new persistence — no IndexedDB store, no localStorage key, no service-worker cache.

## Lifecycle / control flow

1. Reached from the drawer (`Stats`) or via the picker round-trip (`/vehicles?from=stats`).
2. Loader resolves the active vehicle via the shared `resolveSelectedVehicle()` helper (`$lib/client/vehicle-resolve.ts`): `URL ?vehicleId= → prefs.lastVehicleId → vehicles[0]` (identical to maintenance and history).
3. With a vehicle, the loader calls `getVehicleInfo(id)`; success → `{ vehicle, info, error: null }`, failure → `{ vehicle, info: null, error: message }`. No vehicle → `error: 'no-vehicle'`.
4. The page is a pure render of the loader result. `formatCost(x, null)` resolves the instance currency through `format.ts`; `$derived` values come from `stats.ts`.

## Edge cases & invariants

| Scenario                                             | Behaviour                                                                 | Why                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| All five category counts 0                           | Header + identifiers + "No records logged for this vehicle yet." only     | An all-`$0.00` page is noise; matches the mockup's empty variant                  |
| A category count is 0 (e.g. Tax)                     | That breakdown row is hidden                                              | `costRows` filters `count > 0`                                                    |
| All four reminder counts 0                           | Reminder line hidden                                                      | `reminderSummary` returns null; `nextReminder` no longer affects visibility       |
| No-records vehicle that still has reminders          | Reminder line NOT shown on `/stats`                                       | Empty state short-circuits the whole body; reminders still live on `/maintenance` |
| `vehicleData.purchasePrice` absent / 0 / non-numeric | Purchase-price line hidden                                                | `purchasePrice` guards `typeof === 'number' && > 0`                               |
| LubeLogger unreachable                               | Amber banner; header + identifiers still show (vehicle list is SW-cached) | Same as maintenance; `/api/vehicle/info` is not precached                         |
| `vehicleId` unresolvable                             | "Pick a vehicle first." + link to `/vehicles?from=stats`                  | `error: 'no-vehicle'`                                                             |

## Non-obvious decisions

- **TCO subtext shows record count only, not a date.** The mockup hinted "· since Apr 2024", but `/api/vehicle/info` carries no earliest-record date and a date range is time-series-adjacent (out of scope). The count is the sum of the five category counts — derivable, so kept.
- **TCO is the one number we compute.** Per the spec, all other figures are LubeLogger's own; TCO is plain addition of its category costs, not a derived metric (no MPG — LubeLogger exposes no aggregate, and its per-record `fuelEconomy` is in an instance-specific unit).
- **`formatCost(x, null)` over passing an explicit currency.** Null routes through `format.ts`'s `effectiveCurrencyCode()` = the cached LubeLogger instance currency — exactly the currency these costs are in — with a USD fallback that's byte-identical for the en-US/USD primary user.
- **Server unwraps the array, client never sees it.** `getVehicleInfo` returns the single object; an empty array becomes a `LubeLoggerError(502)`, so the page's "unreachable" path covers a malformed payload too.
- **The reminder card shows counts only — no named "next" reminder.** It used to render `nextReminder.description` under the past-due badge, but LubeLogger's `nextReminder` is the next _upcoming_ item and skips past-due ones. With a brake-fluid reminder past due and an oil change due in months, the card read as "Engine Oil change — past due", which it wasn't. `/api/vehicle/info` only carries a past-due _count_, not the past-due reminder's name, so naming the real culprit would need a second `/api/vehicle/reminders` fetch that duplicates `/maintenance`. The compact card therefore shows `{pastDue} Past Due · {upcoming} upcoming` and links to `/maintenance` for the detail.

## Cross-references

- [`idb-and-api.md`](./idb-and-api.md) — `GET /api/vehicle/info` row, `VehicleInfo` shape, client surface.
- [`maintenance-page.md`](./maintenance-page.md) — the page pattern this clones (vehicle resolution, picker round-trip, unreachable handling).
